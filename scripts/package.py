"""Build one self-contained addon ZIP, using only Python's standard library."""
import hashlib
import json
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
name = f"{manifest['id']}-{manifest['version']}.zip"
if pathlib.Path(name).name != name or "\\" in name:
    raise ValueError("Invalid package identity")
destination.mkdir(parents=True, exist_ok=True)
target = destination / name
with zipfile.ZipFile(target, "w") as archive:
    for filename in ("manifest.json", "panel.html"):
        contents = (source / filename).read_text(encoding="utf-8").encode("utf-8")
        if len(contents) > (4096 if filename == "manifest.json" else 2 * 1024 * 1024):
            raise ValueError(f"{filename} exceeds the host limit")
        info = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, contents)
if target.stat().st_size > 2 * 1024 * 1024:
    raise ValueError("Archive exceeds the host limit")
digest = hashlib.sha256(target.read_bytes()).hexdigest()
pathlib.Path(str(target) + ".sha256").write_text(f"{digest}  {name}\n", encoding="utf-8")
print(f"{digest}  {target}")
