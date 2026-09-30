# Mobile image ingestion: decoder build scope

HEIC/HEIF is included in mobile image-ingestion evaluation because iOS Photos
may provide these formats. This build-hardening change pins and tests the local
HEIF decoder in the backend image. It does not change the upload endpoint,
canonicalization, Basic input path, or Advanced reference path. Those
application changes are outside this commit and must not be inferred from the
decoder smoke test.

## HEIC/HEIF decoder and licensing

- `pillow-heif==1.4.0` source code is BSD-3-Clause. Its release metadata also
  lists GPLv2 because binary wheels bundle codec libraries, including GPLv2
  `x265`. The backend forces a source build and does not link that encoder;
  the built extension was checked and links the system `libheif` only.
- `libheif` is LGPL-3.0-or-later; tested Debian package:
  `1.19.8-1+deb13u1`.
- `libde265` is LGPL-3.0-or-later; tested Debian package:
  `1.0.15-1+deb13u2`. The backend installs the HEVC decoder plugin and removes
  compile-time development packages after building the binding.
- Debian's `libheif1` also requires one AV1 decoder plugin; this image pins
  `libheif-plugin-dav1d` `1.19.8-1+deb13u1` and `libdav1d7` `1.5.1-1`.
  `dav1d` is BSD-2-Clause. This plugin is installed to satisfy Debian package
  dependencies; HEVC test decoding uses the `libde265` plugin.

The decoder reads HEIC/HEIF in the synthetic runtime smoke test. It is not used
to encode customer photos. Before distributing a rebuilt backend image, retain
the distro package license notices and review the exact package SBOM for the
selected Debian base image. Passing this test confirms the image can decode
the fixture; it does not confirm end-to-end mobile upload support.
