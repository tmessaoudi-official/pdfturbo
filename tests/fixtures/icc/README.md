# ICC colour fixture (row 37)

`cmyk-patches.pdf` — one 400×120 pt page, five 60 pt patches, written with `@cantoo/pdf-lib` (raw content stream):

| x (pt) | Patch | Operators | Ghostscript 10.06 at -r72 |
|---|---|---|---|
| 20 | DeviceCMYK rich black | `0.75 0.68 0.67 0.9 k` | (9,15,16) with pdf.js's profile; (2,2,2) with gs's default |
| 95 | DeviceCMYK cyan | `1 0 0 0 k` | (0,174,239) either way |
| 170 | DeviceCMYK mid tone | `0.2 0.6 0 0.1 k` | (181,114,165) with pdf.js's profile; (181,115,166) default |
| 245 | ICCBased mid tone | `/CS0 cs 0.2 0.6 0 0.1 scn`, `/CS0` = `[/ICCBased <profile>]`, N 4, Alternate DeviceCMYK | (181,114,165) either way |
| 320 | DeviceRGB control | `0.2 0.4 0.6 rg` | (51,102,153) |

The embedded profile is `node_modules/pdfjs-dist/iccs/CGATS001Compat-v2-micro.icc` (pdf.js's own default CMYK
profile; licence in `node_modules/pdfjs-dist/iccs/LICENSE`). Reference renders:

```
gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r72 -o out.png cmyk-patches.pdf
gs … -sDefaultCMYKProfile=CGATS001Compat-v2-micro.icc -o out-cgats.png cmyk-patches.pdf
```

Sampled at y = 60 px, the patch centres. The ICCBased patch carries its own profile, so every colour-managed
renderer must agree on it; the DeviceCMYK patches depend on the viewer's default CMYK profile.
