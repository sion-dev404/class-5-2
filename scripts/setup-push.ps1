# 푸시 알림 서버 설정 (한 번만). 저장소 폴더에서 PowerShell 로 실행:
#   .\scripts\setup-push.ps1 -ProjectRef abcdefghijklmnop -ServiceAccount C:\경로\firebase-서비스계정.json
# ProjectRef     : Supabase 주소 https://[이 부분].supabase.co 의 앞부분
# ServiceAccount : Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" 으로 받은 JSON 파일
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$ServiceAccount
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ServiceAccount)) { throw "서비스 계정 파일을 찾을 수 없어요: $ServiceAccount" }

Write-Host '1/4 Supabase 로그인 (브라우저가 열려요. 허용을 눌러 주세요)'
npx --yes supabase login

Write-Host '2/4 비밀 값 저장'
$secret = -join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
# 따옴표가 깨지지 않게 임시 파일로 넘기고, 끝나면 바로 지움
$json = (Get-Content $ServiceAccount -Raw | ConvertFrom-Json | ConvertTo-Json -Compress)
$envFile = Join-Path $env:TEMP 'class52-push-secrets.env'
try {
  $lines = @("PUSH_SECRET=$secret", "FIREBASE_SERVICE_ACCOUNT='$json'")
  [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
  npx --yes supabase secrets set --project-ref $ProjectRef --env-file $envFile
}
finally {
  if (Test-Path $envFile) { Remove-Item $envFile -Force }
}

Write-Host '3/4 발송 함수 올리기'
npx --yes supabase functions deploy send-push --no-verify-jwt --project-ref $ProjectRef

Write-Host '4/4 SQL 파일 만들기'
$sql = @"
insert into public.push_config (id, url, secret)
values (1, 'https://$ProjectRef.supabase.co/functions/v1/send-push', '$secret')
on conflict (id) do update set url = excluded.url, secret = excluded.secret;
"@
Set-Content -Path 'supabase\push-config.local.sql' -Value $sql -Encoding UTF8

Write-Host ''
Write-Host '끝! 이제 Supabase 화면 → SQL Editor 에서 아래 두 파일 내용을 차례로 붙여넣고 Run 하세요.'
Write-Host '  1) supabase\push.sql'
Write-Host '  2) supabase\push-config.local.sql   (비밀 값이 들어 있어요. GitHub에는 올라가지 않아요)'
