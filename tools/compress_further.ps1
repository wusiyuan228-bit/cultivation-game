# 二次压缩测试脚本：
# - 卡牌小图 Q85 -> Q82  (视觉几乎无损，体积再 -15%)
# - 卡牌大图 Q88 -> Q85  (视觉几乎无损，体积再 -18%)
# - 大型 PNG (bg_character_select.png) 尝试通过 GDI+ 重编码 + 保持透明通道
#
# 原图存放在 03_美术资源/卡牌美术/ ，是真正的"源"；
# 此脚本从源图重新生成 public/images/cards 和 cards_full
Add-Type -AssemblyName System.Drawing

$SRC_DIR = "C:\Users\Administrator\Cardwar\CardWar-AI\03_美术资源\卡牌美术"
$DST_CARDS = "C:\Users\Administrator\Cardwar\CardWar-AI\04_程序开发\cardwar-ai\public\images\cards"
$DST_FULL  = "C:\Users\Administrator\Cardwar\CardWar-AI\04_程序开发\cardwar-ai\public\images\cards_full"

# 中文名 -> 英文id 映射
$nameMap = @{
    "寒立"        = "hero_hanli"
    "塘散"        = "hero_tangsan"
    "小舞儿"      = "hero_xiaowu"
    "萧焱"        = "hero_xiaoyan"
    "薰儿"        = "hero_xuner"
    "旺林"        = "hero_wanglin"
    "唐昊"        = "bssr_tanghao"
    "二明"        = "bssr_erming"
    "药尘"        = "bssr_yaochen"
    "古原"        = "bssr_guyuan"
    "南宫婉"      = "bssr_nangongwan"
}

function Save-Jpeg {
    param($SrcPath, $DstPath, $TargetW, $TargetH, $Quality)
    $img = [System.Drawing.Image]::FromFile($SrcPath)
    $bmp = New-Object System.Drawing.Bitmap $TargetW, $TargetH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($img, 0, 0, $TargetW, $TargetH)

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    $bmp.Save($DstPath, $codec, $params)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}

$files = Get-ChildItem -Path $SRC_DIR -Filter *.png -File
$totalBefore = 0
$totalAfter = 0

foreach ($f in $files) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    if (-not $nameMap.ContainsKey($baseName)) {
        Write-Host "[跳过] 未知角色: $baseName" -ForegroundColor Yellow
        continue
    }
    $id = $nameMap[$baseName]
    $smallPath = Join-Path $DST_CARDS "$id.jpg"
    $fullPath  = Join-Path $DST_FULL  "$id.jpg"

    # 小图 600x800 Q82
    Save-Jpeg $f.FullName $smallPath 600 800 82
    # 大图 1200x1600 Q85
    Save-Jpeg $f.FullName $fullPath 1200 1600 85

    $smallKB = [math]::Round((Get-Item $smallPath).Length/1KB, 1)
    $fullKB  = [math]::Round((Get-Item $fullPath).Length/1KB, 1)
    Write-Host ("[OK] {0,-18} small={1,6}KB  full={2,6}KB" -f $id, $smallKB, $fullKB)

    $totalAfter += (Get-Item $smallPath).Length + (Get-Item $fullPath).Length
}

Write-Host ""
Write-Host ("全部卡牌合计: {0} MB" -f [math]::Round($totalAfter/1MB, 2)) -ForegroundColor Cyan
