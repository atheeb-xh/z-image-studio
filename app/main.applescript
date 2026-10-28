-- Z-Image Studio: keeps the server running while the app is open.
property pidFile : "\"$HOME/Library/Application Support/Z-Image Studio/server.pid\""

on run
	set launcher to quoted form of (POSIX path of (path to resource "launch.sh"))
	do shell script launcher & " > /dev/null 2>&1 &"
end run

on reopen
	do shell script "open http://127.0.0.1:7860"
end reopen

on idle
	-- Quit the app when the server stops (Quit on the page, a crash, or a failed start).
	try
		do shell script "f=" & pidFile & "; [ ! -f \"$f\" ] || kill -0 $(cat \"$f\")"
	on error
		quit
	end try
	return 3
end idle

on quit
	try
		do shell script "f=" & pidFile & "; [ -f \"$f\" ] && kill $(cat \"$f\") 2>/dev/null; rm -f \"$f\"; true"
	end try
	continue quit
end quit
