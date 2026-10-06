"""One standard-library regression for deterministic root-only packages."""
import hashlib
import pathlib
import subprocess
import sys
import tempfile
import zipfile

packager = pathlib.Path(__file__).with_name("package.py")
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    source = root / "source"
    source.mkdir()
    (source / "manifest.json").write_bytes(b'{"id":"example.test","version":"1.0.0"}\n')
    (source / "panel.html").write_bytes(b"<p>Example</p>\n")
    subprocess.run([sys.executable, str(packager), str(source), str(root / "first")], check=True)
    for file in source.iterdir():
        file.write_bytes(file.read_bytes().replace(b"\n", b"\r\n"))
    subprocess.run([sys.executable, str(packager), str(source), str(root / "second")], check=True)
    first = root / "first/example.test-1.0.0.zip"
    second = root / "second/example.test-1.0.0.zip"
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        assert archive.namelist() == ["manifest.json", "panel.html"]
        assert archive.read("panel.html") == b"<p>Example</p>\n"
    assert pathlib.Path(str(first) + ".sha256").read_text().split()[0] == hashlib.sha256(first.read_bytes()).hexdigest()
print("Package check passed")
