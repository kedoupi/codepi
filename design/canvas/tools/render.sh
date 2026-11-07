#!/bin/zsh
# 量画板真实高度并截图：tools/render.sh [--out <build 目录>] 名:宽 ...
# 先运行 tools/build.py 生成预览；本脚本用 Chrome（apps/health/scripts/browser-cdp.mjs）打开 build/preview/<名>.html，
# 打印「ok 名 高度」，截图写 build/shots/。把量到的高度写回 data/heights.json 再 build 一次。
set -e
HERE=${0:A:h}
OUT=${HERE:h}/build
if [[ $1 == --out ]]; then OUT=${2:A}; shift 2; fi
mkdir -p $OUT/shots
args=()
for p in "$@"; do n=${p%%:*}; w=${p##*:}; args+=("$n|$w|file://$OUT/preview/$n.html"); done
node $HERE/live3.mjs $OUT/shots "${args[@]}" | grep '^ok'
