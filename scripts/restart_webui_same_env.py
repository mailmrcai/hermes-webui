#!/usr/bin/env python3
"""Restart a running WebUI process from its own /proc argv/env/cwd (no guessed flags).

Usage: python3 scripts/restart_webui_same_env.py --port 8513 [--timeout 45]
Safe to run detached; the new process is start_new_session'd and appends to the
profile's bootstrap-<port>.log. Reads pid via ss; never pkill -f.
"""
import argparse, os, signal, socket, subprocess, sys, time

def pids_on_port(port):
    out = subprocess.run(["bash", "-lc", f"ss -ltnp 2>/dev/null | grep ':{port} ' | grep -oP 'pid=\\K[0-9]+'"],
                         capture_output=True, text=True).stdout
    return [int(x) for x in out.split() if x.isdigit()]

def port_open(port):
    s = socket.socket(); s.settimeout(0.3)
    try: return s.connect_ex(("127.0.0.1", port)) == 0
    finally: s.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8513)
    ap.add_argument("--timeout", type=float, default=45)
    args = ap.parse_args()
    pids = pids_on_port(args.port)
    if not pids:
        print("no listener on", args.port); return 0
    pid = pids[0]
    argv = [a.decode() for a in open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0") if a]
    env = {}
    for kv in open(f"/proc/{pid}/environ", "rb").read().split(b"\0"):
        if b"=" in kv:
            k, v = kv.split(b"=", 1); env[k.decode()] = v.decode()
    cwd = os.readlink(f"/proc/{pid}/cwd")
    state = env.get("HERMES_WEBUI_STATE_DIR") or os.path.expanduser("~/.hermes/webui")
    log = os.path.join(state, f"bootstrap-{args.port}.log")
    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + args.timeout
    while port_open(args.port) and time.time() < deadline:
        time.sleep(0.25)
    if port_open(args.port):
        os.kill(pid, signal.SIGKILL); time.sleep(1)
    print("closed:", not port_open(args.port))
    with open(log, "ab") as fh:
        fh.write(f"\n=== restart {time.strftime('%Y-%m-%d %H:%M:%S')} (restart_webui_same_env) ===\n".encode())
        p = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                             stdout=fh, stderr=subprocess.STDOUT, start_new_session=True)
    print("new pid:", p.pid)
    deadline = time.time() + args.timeout
    while not port_open(args.port) and time.time() < deadline:
        time.sleep(0.25)
    print("listening:", port_open(args.port))
    return 0 if port_open(args.port) else 1

if __name__ == "__main__":
    sys.exit(main())
