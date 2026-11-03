@echo off
title Tikoder Native (Node 26)
cd /d "D:\Nho\Tikoder"
echo Dang chay Tikoder che do native bang Node 26 (tiet kiem RAM, khong can Docker)...
node --max-old-space-size=128 server.js
pause
