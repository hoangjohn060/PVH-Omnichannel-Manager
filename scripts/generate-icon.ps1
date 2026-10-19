$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(52,120,246))
$font = New-Object System.Drawing.Font 'Segoe UI',148,([System.Drawing.FontStyle]::Bold)
$graphics.DrawString('P',$font,[System.Drawing.Brushes]::White,31,7)
$bitmap.Save((Join-Path $root 'apps\desktop\assets\icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
$data = $stream.ToArray()
$file = [System.IO.File]::Create((Join-Path $root 'apps\desktop\build\icon.ico'))
$writer = New-Object System.IO.BinaryWriter $file
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$data.Length); $writer.Write([uint32]22); $writer.Write($data)
$writer.Dispose(); $stream.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()