#!/bin/bash
# Photo Slides — Mac орнатқышы.
# Плагин файлдары ~/PhotoSlides қалтасында тұрады, Premiere оған сілтеме арқылы қарайды.
# Сол қалтадағы файл өзгерсе, панель өзі жаңарады — қайта орнатудың қажеті жоқ.
cd "$(dirname "$0")" || exit 1
SRC="$HOME/PhotoSlides"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/PhotoSlides"
mkdir -p "$SRC" "$(dirname "$DEST")"
cp -R "PhotoSlides/." "$SRC/" || { echo "Қате: көшіру мүмкін болмады"; exit 1; }
rm -rf "$DEST"
ln -s "$SRC" "$DEST" || { echo "Қате: сілтеме жасалмады"; exit 1; }
for v in 9 10 11 12 13 14; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null
echo ""
echo "Photo Slides орнатылды: $SRC"
echo "Premiere Pro-ны бір рет қайта ашыңыз: Window > Extensions > Photo Slides"
