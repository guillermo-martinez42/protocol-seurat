# Seurat/1 LAN run for Windows PowerShell
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Ensure runtime and build directories exist
New-Item -ItemType Directory -Force -Path ".seurat/runtime/inbox", ".seurat/runtime/obras", ".seurat/runtime/cobertura", ".seurat/build/classes" | Out-Null

# Check Java version for preview features (JDK 20 needs --enable-preview; JDK 21+ has virtual threads finalized)
$compileFlags = @()
$runFlags = @()
$v = (& { $ErrorActionPreference = 'Continue'; java -version } 2>&1) -join ' '
if ($v -match '20\.') {
    $compileFlags = @("--enable-preview", "--release", "20")
    $runFlags = @("--enable-preview")
}

# Frontend build
if ((Test-Path "client/package.json") -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    try {
        Push-Location client
        if (-not (Test-Path "node_modules")) {
            Write-Host "Installing client dependencies..."
            npm install --legacy-peer-deps 2>$null | Out-Null
        }
        Write-Host "Building client..."
        npm run build 2>$null | Out-Null
        Pop-Location
    } catch {
        Pop-Location
        Write-Host "Client build failed."
    }
}

Write-Host "Compiling Java backend..."
$sources = Get-ChildItem -Path "src/main/java" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
javac @compileFlags -d .seurat/build/classes $sources

Write-Host "Starting Seurat/1 Server..."
# Ingest heap grows with image width (~2.5 GB live at 196,608 px); 6G leaves GC headroom.
java @runFlags -Xmx6G -cp .seurat/build/classes seurat.SeuratServer @args
