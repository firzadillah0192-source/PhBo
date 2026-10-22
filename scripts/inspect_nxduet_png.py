"""Inspect PNG alpha without dependencies or changing the image."""
import struct
import sys
import zlib


def inspect(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, packed = 8, bytearray()
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + size]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
        if kind == b'IDAT':
            packed.extend(chunk)
        offset += 12 + size
    if color != 6 or depth != 8 or interlace:
        raise ValueError('Expected non-interlaced RGBA8 PNG')
    raw, stride = zlib.decompress(packed), width * 4
    previous = bytearray(stride)
    transparent, partial, opaque = 0, 0, 0
    for y in range(height):
        start = y * (stride + 1)
        filter_type = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            a = row[x - 4] if x >= 4 else 0
            b = previous[x]
            c = previous[x - 4] if x >= 4 else 0
            if filter_type == 1:
                predict = a
            elif filter_type == 2:
                predict = b
            elif filter_type == 3:
                predict = (a + b) // 2
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predict = a if pa <= pb and pa <= pc else b if pb <= pc else c
            elif filter_type == 0:
                predict = 0
            else:
                raise ValueError('Unknown PNG filter')
            row[x] = (row[x] + predict) & 255
        for alpha in row[3::4]:
            transparent += alpha == 0
            partial += 0 < alpha < 255
            opaque += alpha == 255
        previous = row
    print(path, {'size': [width, height], 'transparent': transparent, 'partial': partial, 'opaque': opaque})
    if not transparent or not opaque:
        raise ValueError('Image must have both transparent and opaque pixels')


if __name__ == '__main__':
    for filename in sys.argv[1:]:
        inspect(filename)
