#!/usr/bin/env python3
"""Publish a signed NXBooth desktop installer so kiosks can update from the app.

Copies NXBooth-Setup-<x.y.z>.exe plus a manifest.json (version, sha256, size) into
/srv/photobooth/desktop-updates, which photobooth-express already mounts. The manifest is
written last and atomically, so a kiosk never sees a version whose file is incomplete.
It touches no container, database or gateway. Use --dry-run to only print what would happen.
"""
import argparse, hashlib, json, os, re, shutil, sys, tempfile

NAME = re.compile(r"^NXBooth-Setup-(\d{1,4}\.\d{1,4}\.\d{1,4})\.exe$")
DEST = "/srv/photobooth/desktop-updates"

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("installer", help="path to the SIGNED NXBooth-Setup-x.y.z.exe")
    ap.add_argument("--notes", default="", help="short release note shown to staff (max 500 chars)")
    ap.add_argument("--dest", default=DEST)
    ap.add_argument("--keep", type=int, default=3, help="older installers to keep for rollback (default 3 including the new one)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    name = os.path.basename(a.installer)
    m = NAME.match(name)
    if not m: sys.exit(f"File name must look like NXBooth-Setup-1.2.3.exe, got {name}")
    if len(a.notes) > 500: sys.exit("Notes are limited to 500 characters")
    size = os.path.getsize(a.installer)
    if size <= 0 or size > 500 * 1024 * 1024: sys.exit("Installer size is out of range")
    with open(a.installer, "rb") as f:
        if f.read(2) != b"MZ": sys.exit("Not a Windows executable")
        f.seek(0)
        digest = hashlib.sha256()
        for chunk in iter(lambda: f.read(1 << 20), b""): digest.update(chunk)
    manifest = {"version": m.group(1), "file": name, "sha256": digest.hexdigest(), "size": size}
    if a.notes: manifest["notes"] = a.notes
    print(json.dumps(manifest, indent=2))
    if a.dry_run: print("dry run: nothing written"); return
    os.makedirs(a.dest, exist_ok=True)
    target = os.path.join(a.dest, name)
    with tempfile.NamedTemporaryFile(dir=a.dest, delete=False) as tmp:
        with open(a.installer, "rb") as src: shutil.copyfileobj(src, tmp)
    os.chmod(tmp.name, 0o644); os.replace(tmp.name, target)
    with tempfile.NamedTemporaryFile("w", dir=a.dest, delete=False) as tmp:
        json.dump(manifest, tmp); tmp.write("\n")
    os.chmod(tmp.name, 0o644); os.replace(tmp.name, os.path.join(a.dest, "manifest.json"))
    print(f"published {name} to {a.dest}")
    # Prune old installers (never the one the manifest names).
    key = lambda f: tuple(int(x) for x in NAME.match(f).group(1).split("."))
    old = sorted((f for f in os.listdir(a.dest) if NAME.match(f) and f != name), key=key, reverse=True)
    for f in old[max(a.keep - 1, 0):]:
        os.remove(os.path.join(a.dest, f)); print(f"removed old {f}")

if __name__ == "__main__":
    main()
