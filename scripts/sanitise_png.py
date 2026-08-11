from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop a rendered PDF page and save a metadata-free RGB PNG."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("left", type=int)
    parser.add_argument("top", type=int)
    parser.add_argument("right", type=int)
    parser.add_argument("bottom", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    box = (args.left, args.top, args.right, args.bottom)
    if args.right <= args.left or args.bottom <= args.top:
        raise ValueError(f"Invalid crop box: {box}")

    with Image.open(args.input) as source:
        width, height = source.size
        if not (
            0 <= args.left < args.right <= width
            and 0 <= args.top < args.bottom <= height
        ):
            raise ValueError(f"Crop box {box} exceeds source size {(width, height)}")
        cleaned = source.crop(box).convert("RGB")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        cleaned.save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
