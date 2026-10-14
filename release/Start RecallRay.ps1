$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}

$templateKey = 'API_KEY=your_nebius_token_factory_key'
$envLines = Get-Content -LiteralPath '.env'
if ([string]::IsNullOrWhiteSpace($env:API_KEY) -and $envLines -contains $templateKey) {
    $secureKey = Read-Host 'Nebius Token Factory API key (input hidden)' -AsSecureString
    if ($secureKey.Length -eq 0) {
        Write-Host 'An API key is required. Add it to .env and start RecallRay again.'
        Read-Host 'Press Return to close' | Out-Null
        exit 1
    }
    $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try { $env:API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr) }
}

if ([string]::IsNullOrWhiteSpace($env:API_KEY) -and $envLines -contains $templateKey) {
    Write-Host 'Set API_KEY in .env before starting RecallRay.'
    exit 1
}

& (Join-Path $PSScriptRoot 'recallray.exe') @args
$status = $LASTEXITCODE
if ($status -ne 0) {
    Write-Host "`nRecallRay stopped with an error (exit $status)."
    Read-Host 'Press Return to close' | Out-Null
}
exit $status
