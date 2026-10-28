// Z-Image Studio: the native window. It starts the Python engine (engine/server.py),
// shows the UI the engine serves in a WebKit view, and handles what a web page
// can't do well: Save panels, the clipboard, and background removal (Apple Vision).

import Cocoa
import CoreImage
import Vision
import WebKit

let appName = "Z-Image Studio"
let res = Bundle.main.resourceURL!
let dataDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent(appName)
let logURL = dataDir.appendingPathComponent("log.txt")

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var engine: Process?
    var port = 0

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")  // no white flash before the page paints

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = appName
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(red: 0.055, green: 0.055, blue: 0.065, alpha: 1)
        window.minSize = NSSize(width: 980, height: 640)
        // A web view eats mouse events, so give the header area back to the window for dragging.
        let root = NSView()
        web.frame = root.bounds
        web.autoresizingMask = [.width, .height]
        root.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 80, y: 0, width: 400, height: 44))
        strip.autoresizingMask = [.width, .minYMargin]
        root.addSubview(strip)
        window.contentView = root  // the window sizes root to fill it
        strip.frame = NSRect(x: 80, y: root.bounds.height - 44, width: root.bounds.width - 80 - 300, height: 44)
        window.setFrameAutosaveName("main")
        if !window.setFrameUsingName("main") { window.center() }
        window.makeKeyAndOrderFront(nil)

        showMessage("Starting…", detail: "")
        DispatchQueue.global().async { self.startEngine() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) {
        engine?.terminate()
        engine?.waitUntilExit()
    }

    // MARK: engine

    func startEngine() {
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try! FileHandle(forWritingTo: logURL)
        let uv = res.appendingPathComponent("uv").path
        let python = dataDir.appendingPathComponent("venv/bin/python").path
        var env = ProcessInfo.processInfo.environment
        env["UV_PYTHON_INSTALL_DIR"] = dataDir.appendingPathComponent("python").path
        env["UV_CACHE_DIR"] = dataDir.appendingPathComponent("cache").path
        env["ZIS_UV"] = uv
        env["ZIS_UI"] = res.appendingPathComponent("ui").path

        if !FileManager.default.isExecutableFile(atPath: python) {
            DispatchQueue.main.async { self.showMessage("Setting up", detail: "Getting Python ready. This happens once.") }
            let venv = Process()
            venv.executableURL = URL(fileURLWithPath: uv)
            venv.arguments = ["venv", "--python", "3.13", dataDir.appendingPathComponent("venv").path]
            venv.environment = env
            venv.standardOutput = log
            venv.standardError = log
            do { try venv.run() } catch { return fail("Couldn't run the installer: \(error.localizedDescription)") }
            venv.waitUntilExit()
            if venv.terminationStatus != 0 {
                try? FileManager.default.removeItem(at: dataDir.appendingPathComponent("venv"))
                return fail("Setup needs the internet the first time. Check your connection and try again.")
            }
        }

        port = freePort()
        env["ZIS_PORT"] = String(port)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: python)
        p.arguments = ["-u", res.appendingPathComponent("engine/server.py").path]
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = log
        p.terminationHandler = { [weak self] proc in
            guard let self, proc.terminationReason != .uncaughtSignal || proc.terminationStatus != 15 else { return }
            self.fail("The engine stopped unexpectedly.")
        }
        do { try p.run() } catch { return fail("Couldn't start the engine: \(error.localizedDescription)") }
        engine = p

        // Wait for "LISTENING <port>", copying everything else to the log.
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let self else { return }
            log.write(data)
            if String(decoding: data, as: UTF8.self).contains("LISTENING") {
                h.readabilityHandler = { h in log.write(h.availableData) }
                DispatchQueue.main.async {
                    self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(self.port)/")!))
                }
            }
        }
    }

    func freePort() -> Int {
        let s = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(s) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                _ = Darwin.bind(s, $0, len)
                _ = getsockname(s, $0, &len)
            }
        }
        return Int(UInt16(bigEndian: addr.sin_port))
    }

    func fail(_ message: String) {
        DispatchQueue.main.async {
            self.showMessage("Something went wrong", detail: message + "<br><br><small>Details: ~/Library/Application Support/\(appName)/log.txt</small>", retry: true)
        }
    }

    func showMessage(_ title: String, detail: String, retry: Bool = false) {
        let button = retry ? "<button onclick=\"webkit.messageHandlers.native.postMessage({action:'restart'})\">Try again</button>" : "<div class=s></div>"
        web.loadHTMLString("""
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0e0e11;color:#ececee;
        font:15px -apple-system,system-ui;text-align:center;-webkit-user-select:none">
        <div><div style="font-size:20px;font-weight:600;margin-bottom:8px">\(title)</div>
        <div style="color:#8b8d94;max-width:420px;line-height:1.5;margin-bottom:22px">\(detail)</div>\(button)</div>
        <style>.s{width:26px;height:26px;margin:auto;border:3px solid #2a2c31;border-top-color:#f5c542;border-radius:50%;animation:r .9s linear infinite}
        @keyframes r{to{transform:rotate(360deg)}}button{background:#f5c542;border:0;border-radius:10px;padding:10px 18px;font:600 14px -apple-system;cursor:pointer}</style>
        </body></html>
        """, baseURL: nil)
    }

    // MARK: messages from the page

    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let body = msg.body as? [String: Any], let action = body["action"] as? String else { return }
        let id = body["id"] as? String ?? ""
        switch action {
        case "save": fetch(body["url"] as? String) { self.save($0, name: body["name"] as? String ?? "image.png") }
        case "copy": fetch(body["url"] as? String) { data in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setData(data, forType: .png)
            self.reply(id, ["ok": true])
        }
        case "removeBackground": fetch(body["url"] as? String) { data in
            DispatchQueue.global().async {
                let png = self.cutOut(data)
                self.reply(id, png.map { ["data": "data:image/png;base64," + $0.base64EncodedString()] } ?? ["error": "No clear subject found to cut out."])
            }
        }
        case "restart":
            engine?.terminationHandler = nil
            engine?.terminate()
            showMessage("Starting…", detail: "")
            DispatchQueue.global().async { self.startEngine() }
        default: break
        }
    }

    func reply(_ id: String, _ payload: [String: Any]) {
        guard !id.isEmpty, let json = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: json, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web.evaluateJavaScript("window.nativeReply('\(id)', \(text))") }
    }

    func fetch(_ path: String?, then: @escaping (Data) -> Void) {
        guard let path, let url = URL(string: path, relativeTo: URL(string: "http://127.0.0.1:\(port)/")) else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data { DispatchQueue.main.async { then(data) } }
        }.resume()
    }

    func save(_ data: Data, name: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [.png]
        panel.beginSheetModal(for: window) { r in
            if r == .OK, let url = panel.url { try? data.write(to: url) }
        }
    }

    /// Lifts the main subject off its background, like Photos does.
    func cutOut(_ data: Data) -> Data? {
        guard let input = CIImage(data: data) else { return nil }
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(ciImage: input)
        guard (try? handler.perform([request])) != nil, let result = request.results?.first,
              let buffer = try? result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
        else { return nil }
        let ctx = CIContext()
        let out = CIImage(cvPixelBuffer: buffer)
        return ctx.pngRepresentation(of: out, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    }

    // MARK: web view

    // Lets <input type=file> open the normal file picker.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.image]
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    // Links (like a model's page) open in the real browser, not inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.host != "127.0.0.1", url.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

/// The header strip: drag to move the window, double-click to zoom (like a title bar).
final class DragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { window?.zoom(nil) } else { window?.performDrag(with: event) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
