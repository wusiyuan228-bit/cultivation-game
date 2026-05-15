# -*- coding: utf-8 -*-
"""
抠出 tile_enemy 的劫匪营地（圆形主体），消除外圈灰色棋盘格背景。

策略：
1. 读取原始图（自动支持 PNG/WebP）。
2. 从画布四角 flood-fill：识别与四角连通的浅灰棋盘格背景。
3. 形态学扩张 1 像素吃掉抗锯齿边缘。
4. 高斯羽化生成柔和 alpha。
5. 输出 WebP (RGBA)，覆盖 public/images/map/tile_enemy.webp。

用法：
  python scripts/extract_tile_enemy.py [输入图绝对路径]
  - 不传参时，默认读取 public/images/map/tile_enemy.webp（就地抠图）
  - 调试图保存到 scripts/_tile_enemy_cutout.png（每次会被覆盖，可手动删）
"""
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DST_WEBP = ROOT / "public" / "images" / "map" / "tile_enemy.webp"
DBG_PNG = ROOT / "scripts" / "_tile_enemy_cutout.png"


def is_grayish_light(arr: np.ndarray) -> np.ndarray:
    """像素是否为浅灰：r/g/b 极接近且亮度在 195~252。"""
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    max_ch = np.maximum(np.maximum(r, g), b)
    min_ch = np.minimum(np.minimum(r, g), b)
    luma = (r.astype(np.int16) + g + b) // 3
    return ((max_ch - min_ch) <= 8) & (luma >= 195) & (luma <= 252)


def dilate_1px(mask: np.ndarray) -> np.ndarray:
    """对 bool mask 做 1 像素 4-邻域膨胀。"""
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def main() -> None:
    src_arg = sys.argv[1] if len(sys.argv) > 1 else None
    src_path = Path(src_arg).resolve() if src_arg else DST_WEBP
    if not src_path.exists():
        raise SystemExit(f"输入图不存在: {src_path}")

    print(f"input  : {src_path}")
    raw = Image.open(src_path)

    # 防误操作：已抠过的 RGBA 图（存在透明像素）跳过，避免反复侵蚀
    if raw.mode == "RGBA":
        a = np.asarray(raw.split()[-1])
        if (a < 255).any():
            raise SystemExit(
                "输入图已是带透明通道的 RGBA，疑似已抠过。如需强制重跑，请改名或先转回 RGB。"
            )

    im = raw.convert("RGB")
    arr = np.asarray(im, dtype=np.uint8)
    h, w, _ = arr.shape
    print(f"size   : {w}x{h}")

    # 1) 浅灰候选 mask
    gray_mask = is_grayish_light(arr)

    # 2) 用 PIL.ImageDraw.floodfill 从四角进行连通区域填充
    #    我们把候选灰色像素涂成纯白 255、其它涂成黑 0，做单通道图像
    base = (gray_mask.astype(np.uint8) * 255)
    base_img = Image.fromarray(base, mode="L")

    # 创建一个工作图：把目标区域（255）逐个从四角 flood-fill 成 128（标记为"画布外背景"）
    work = base_img.copy()
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for sx, sy in seeds:
        if work.getpixel((sx, sy)) == 255:
            ImageDraw.floodfill(work, (sx, sy), value=128, thresh=0)

    work_arr = np.asarray(work)
    bg_mask = work_arr == 128  # 与四角连通的灰色

    if not bg_mask.any():
        print("WARN: 未从四角检测到棋盘格背景，可能源图已是干净底，回退到全部灰色")
        bg_mask = gray_mask

    # 3) 1 像素膨胀，吃掉边缘抗锯齿
    bg_mask = dilate_1px(bg_mask)

    # 4) alpha
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    alpha_img = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(radius=1.0))

    rgba = im.copy()
    rgba.putalpha(alpha_img)

    DBG_PNG.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(DBG_PNG, optimize=True)
    print(f"debug PNG: {DBG_PNG} ({DBG_PNG.stat().st_size/1024:.1f} KB)")

    DST_WEBP.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(DST_WEBP, format="WEBP", quality=85, method=6)
    print(f"output WEBP: {DST_WEBP} ({DST_WEBP.stat().st_size/1024:.1f} KB)")

    # 统计透明 / 不透明像素
    transparent = int((alpha == 0).sum())
    opaque = int((alpha == 255).sum())
    feather = int(((alpha > 0) & (alpha < 255)).sum())
    print(f"alpha stats — transparent: {transparent}  opaque: {opaque}  feather: {feather}")


if __name__ == "__main__":
    main()
