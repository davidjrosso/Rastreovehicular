param(
    [string]$Server,
    [ValidateRange(1,65535)][int]$Port = 22,
    [switch]$Replace,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskCandidates = @()
$taskInstalled = Get-Command node -ErrorAction SilentlyContinue
if ($taskInstalled) { $taskCandidates += $taskInstalled.Source }
$taskCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$taskNode = $null
foreach ($taskCandidate in $taskCandidates) {
    if (Test-Path -LiteralPath $taskCandidate) {
        $taskVersion = & $taskCandidate --version
        if ([version]$taskVersion.TrimStart('v') -ge [version]'22.12.0') { $taskNode = $taskCandidate; break }
    }
}
if (-not $taskNode) { throw 'Instalar Node.js 24 LTS antes de ejecutar esta herramienta.' }
if ($Check) {
    & $taskNode scripts/production-secrets.mjs check
} else {
    if (-not $Server) { $Server = Read-Host 'Destino SSH (usuario@servidor de producción)' }
    $taskArguments = @('scripts/production-secrets.mjs', 'send', '--host', $Server, '--port', [string]$Port)
    if ($Replace) { $taskArguments += '--replace' }
    & $taskNode @taskArguments
}
exit $LASTEXITCODE
