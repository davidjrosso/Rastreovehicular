$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNode = $null
$taskCandidates = @()
$taskInstalled = Get-Command node -ErrorAction SilentlyContinue
if ($taskInstalled) { $taskCandidates += $taskInstalled.Source }
$taskCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
foreach ($taskCandidate in $taskCandidates) {
    if (Test-Path -LiteralPath $taskCandidate) {
        $taskVersion = & $taskCandidate --version
        if ([version]$taskVersion.TrimStart('v') -ge [version]'22.12.0') {
            $taskNode = $taskCandidate
            break
        }
    }
}
if (-not $taskNode) { throw 'Instalar Node.js 24 LTS antes de iniciar Rastreo.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules\tsx'))) {
    throw 'Faltan dependencias. Ejecutar npm ci con Node.js 24.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'dist\index.html'))) {
    & $taskNode node_modules/typescript/bin/tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar TypeScript.' }
    & $taskNode node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la aplicación.' }
}
Write-Host 'Rastreo: http://localhost:3001 - Ctrl+C para detener.'
$taskNodeArgs = @('--import', 'tsx', 'server/index.ts')
# Use the OS trust store when supported, while retaining certificate and hostname validation.
$taskNodeHelp = & $taskNode --help
if (($taskNodeHelp -join "`n") -match '--use-system-ca') {
    $taskNodeArgs = @('--use-system-ca') + $taskNodeArgs
}
& $taskNode @taskNodeArgs
exit $LASTEXITCODE
