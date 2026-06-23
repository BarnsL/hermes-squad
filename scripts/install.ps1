# =============================================================================
# Hermes Squad — Windows PowerShell Install Script
# =============================================================================
# One-liner installation (run in PowerShell as Administrator):
#   irm https://raw.githubusercontent.com/hermes-squad/hermes-squad/main/scripts/install.ps1 | iex
#
# Or with options:
#   .\install.ps1 -Version "v0.1.0" -InstallDir "C:\tools\hermes"
#
# What this script does:
# 1. Checks Windows version and architecture
# 2. Verifies required dependencies (Node.js, git)
# 3. Downloads the Windows installer or binary
# 4. Installs to default location or specified directory
# 5. Adds to system PATH
# 6. Creates Start Menu shortcut (optional)
# 7. Runs initial configuration
# =============================================================================

#Requires -Version 5.1

[CmdletBinding()]
param(
    # Specific version to install (e.g., "v0.1.0"). Empty = latest.
    [string]$Version = "",

    # Installation directory
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\hermes-squad",

    # Force overwrite existing installation
    [switch]$Force,

    # Skip dependency checks
    [switch]$SkipChecks,

    # Install for all users (requires admin)
    [switch]$AllUsers,

    # Don't add to PATH
    [switch]$NoPath,

    # Don't create Start Menu shortcut
    [switch]$NoShortcut,

    # Verbose output
    [switch]$Verbose
)

# --- Configuration ---
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Speed up Invoke-WebRequest

$Script:Repo = "hermes-squad/hermes-squad"
$Script:DataDir = "$env:APPDATA\hermes-squad"
$Script:TempDir = Join-Path $env:TEMP "hermes-squad-install-$(Get-Random)"

# --- Helper Functions ---

function Write-Banner {
    Write-Host ""
    Write-Host "  ╦ ╦┌─┐┬─┐┌┬┐┌─┐┌─┐  ╔═╗┌─┐ ┬ ┬┌─┐┌┬┐" -ForegroundColor Cyan
    Write-Host "  ╠═╣├┤ ├┬┘│││├┤ └─┐  ╚═╗│─┼┐│ │├─┤ ││" -ForegroundColor Cyan
    Write-Host "  ╩ ╩└─┘┴└─┴ ┴└─┘└─┘  ╚═╝└─┘└└─┘┴ ┴─┴┘" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Multi-Agent Coding Session Orchestrator" -ForegroundColor White
    Write-Host ""
}

function Write-Info {
    param([string]$Message)
    Write-Host "  ℹ " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning2 {
    param([string]$Message)
    Write-Host "  ⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error2 {
    param([string]$Message)
    Write-Host "  ✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Verbose2 {
    param([string]$Message)
    if ($Verbose) {
        Write-Host "    → " -ForegroundColor DarkGray -NoNewline
        Write-Host $Message -ForegroundColor DarkGray
    }
}

# --- System Detection ---

function Get-SystemInfo {
    <#
    .SYNOPSIS
    Detect Windows version, architecture, and available resources
    #>

    $os = [System.Environment]::OSVersion
    $arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }

    # Check Windows version (need Windows 10+)
    if ($os.Version.Major -lt 10) {
        throw "Windows 10 or later is required. Found: $($os.VersionString)"
    }

    # Check for ARM64 Windows
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
        $arch = "arm64"
    }

    return @{
        OS      = "windows"
        Arch    = $arch
        Version = $os.VersionString
        IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
}

# --- Dependency Checks ---

function Test-Dependencies {
    <#
    .SYNOPSIS
    Verify all required and optional dependencies are available
    #>

    Write-Info "Checking dependencies..."

    # Required: git
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Error2 "git is not installed."
        Write-Host "    Install from: https://git-scm.com/download/win" -ForegroundColor Gray
        Write-Host "    Or: winget install Git.Git" -ForegroundColor Gray
        throw "git is required but not found"
    }
    Write-Verbose2 "git: $(git --version)"

    # Required: Node.js 18+
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warning2 "Node.js not found. Attempting to install..."
        Install-NodeJS
    } else {
        $nodeVersion = (node --version) -replace 'v', ''
        $major = [int]($nodeVersion.Split('.')[0])
        if ($major -lt 18) {
            throw "Node.js 18+ required, but found v$nodeVersion. Update with: nvm install 20"
        }
        Write-Verbose2 "Node.js: v$nodeVersion"
    }

    # Optional: Check for AI coding agents
    Write-Host ""
    Write-Info "Checking for AI coding agents..."
    Test-OptionalTool "claude" "Claude Code" "npm install -g @anthropic-ai/claude-code"
    Test-OptionalTool "kiro" "Kiro" "See https://kiro.dev"
    Test-OptionalTool "codex" "OpenAI Codex CLI" "npm install -g @openai/codex"
    Test-OptionalTool "gemini" "Google Gemini CLI" "npm install -g @google/gemini-cli"
    Test-OptionalTool "aider" "Aider" "pip install aider-chat"

    Write-Success "Dependency check complete"
}

function Test-OptionalTool {
    param(
        [string]$Command,
        [string]$Name,
        [string]$InstallHint
    )

    $tool = Get-Command $Command -ErrorAction SilentlyContinue
    if ($tool) {
        Write-Success "  $Name`: installed ✓"
    } else {
        Write-Warning2 "  $Name`: not found (install: $InstallHint)"
    }
}

function Install-NodeJS {
    <#
    .SYNOPSIS
    Install Node.js via winget or direct download
    #>

    # Try winget first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Installing Node.js via winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    } else {
        # Direct download
        Write-Info "Installing Node.js via direct download..."
        $nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi"
        $nodeInstaller = Join-Path $Script:TempDir "node-installer.msi"

        New-Item -ItemType Directory -Path $Script:TempDir -Force | Out-Null
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/quiet", "/norestart" -Wait

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }

    # Verify installation
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js installation failed. Please install manually from https://nodejs.org"
    }
    Write-Success "Node.js installed: $(node --version)"
}

# --- Download & Install ---

function Get-LatestVersion {
    <#
    .SYNOPSIS
    Fetch the latest release version from GitHub
    #>

    $releaseUrl = "https://api.github.com/repos/$Script:Repo/releases/latest"
    try {
        $response = Invoke-RestMethod -Uri $releaseUrl -UseBasicParsing
        return $response.tag_name
    } catch {
        throw "Could not determine latest version. Check your internet connection."
    }
}

function Install-HermesSquad {
    <#
    .SYNOPSIS
    Download and install the Hermes Squad binary
    #>

    param([hashtable]$SystemInfo)

    # Determine version
    if ([string]::IsNullOrEmpty($Version)) {
        Write-Info "Fetching latest version..."
        $Version = Get-LatestVersion
    }

    Write-Info "Installing Hermes Squad $Version for $($SystemInfo.OS)/$($SystemInfo.Arch)..."

    # Construct download URL
    $fileName = "hermes-squad-$Version-win-$($SystemInfo.Arch).zip"
    $downloadUrl = "https://github.com/$Script:Repo/releases/download/$Version/$fileName"
    Write-Verbose2 "Download URL: $downloadUrl"

    # Create temp directory
    New-Item -ItemType Directory -Path $Script:TempDir -Force | Out-Null

    # Download
    Write-Info "Downloading..."
    $zipPath = Join-Path $Script:TempDir $fileName
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        throw "Download failed. Check that version $Version exists for $($SystemInfo.Arch)."
    }

    # Verify checksum
    $checksumUrl = "$downloadUrl.sha256"
    try {
        $expectedHash = (Invoke-RestMethod -Uri $checksumUrl -UseBasicParsing).Split(' ')[0]
        $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
        if ($actualHash -ne $expectedHash) {
            throw "Checksum mismatch! Expected: $expectedHash, Got: $actualHash"
        }
        Write-Success "Checksum verified"
    } catch [System.Net.WebException] {
        Write-Warning2 "No checksum available — skipping verification"
    }

    # Check for existing installation
    $existingBinary = Join-Path $InstallDir "hermes.exe"
    if ((Test-Path $existingBinary) -and -not $Force) {
        $existingVersion = & $existingBinary --version 2>$null
        Write-Warning2 "Hermes Squad is already installed (version: $existingVersion)"
        $confirm = Read-Host "  Overwrite? [y/N]"
        if ($confirm -notmatch '^[Yy]') {
            Write-Info "Installation cancelled."
            return
        }
    }

    # Extract
    Write-Info "Extracting..."
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force

    Write-Success "Installed to $InstallDir\hermes.exe"
}

# --- PATH Setup ---

function Add-ToPath {
    <#
    .SYNOPSIS
    Add the install directory to the user's PATH environment variable
    #>

    if ($NoPath) {
        Write-Verbose2 "Skipping PATH setup (--NoPath specified)"
        return
    }

    # Check if already in PATH
    $currentPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if ($currentPath -split ';' -contains $InstallDir) {
        Write-Verbose2 "$InstallDir is already in PATH"
        return
    }

    Write-Info "Adding $InstallDir to PATH..."

    # Add to user PATH (persists across sessions)
    $newPath = "$InstallDir;$currentPath"
    [System.Environment]::SetEnvironmentVariable("PATH", $newPath, "User")

    # Also update current session
    $env:PATH = "$InstallDir;$env:PATH"

    Write-Success "Added to PATH (restart terminal for full effect)"
}

# --- Start Menu Shortcut ---

function New-StartMenuShortcut {
    <#
    .SYNOPSIS
    Create a Start Menu shortcut for the Electron GUI mode
    #>

    if ($NoShortcut) {
        Write-Verbose2 "Skipping shortcut creation (--NoShortcut specified)"
        return
    }

    $shortcutDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    $shortcutPath = Join-Path $shortcutDir "Hermes Squad.lnk"

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $InstallDir "hermes.exe"
    $shortcut.Arguments = "--electron"
    $shortcut.Description = "Hermes Squad - Multi-Agent Coding Orchestrator"
    $shortcut.WorkingDirectory = $env:USERPROFILE
    $shortcut.Save()

    Write-Success "Start Menu shortcut created"
}

# --- Initial Setup ---

function Initialize-Configuration {
    <#
    .SYNOPSIS
    Create initial configuration and data directories
    #>

    Write-Info "Running initial setup..."

    # Create data directory structure
    $dirs = @(
        $Script:DataDir,
        (Join-Path $Script:DataDir "config"),
        (Join-Path $Script:DataDir "data"),
        (Join-Path $Script:DataDir "skills"),
        (Join-Path $Script:DataDir "logs")
    )
    foreach ($dir in $dirs) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # Create default config if it doesn't exist
    $configPath = Join-Path $Script:DataDir "config\config.json"
    if (-not (Test-Path $configPath)) {
        $defaultConfig = @{
            version        = "1.0.0"
            defaultAgent   = "claude"
            maxSessions    = 5
            enableWorktrees = $true
            theme          = "auto"
            logLevel       = "info"
        } | ConvertTo-Json -Depth 3

        Set-Content -Path $configPath -Value $defaultConfig -Encoding UTF8
    }

    Write-Success "Data directory initialized at $Script:DataDir"
}

# --- Cleanup ---

function Remove-TempFiles {
    if (Test-Path $Script:TempDir) {
        Remove-Item -Path $Script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- Main ---

function Main {
    Write-Banner

    try {
        Write-Info "Starting Hermes Squad installation..."
        Write-Host ""

        # Step 1: Detect system
        $sysInfo = Get-SystemInfo
        Write-Verbose2 "System: $($sysInfo.OS) $($sysInfo.Arch) ($($sysInfo.Version))"
        Write-Verbose2 "Admin: $($sysInfo.IsAdmin)"

        # Warn if not admin and AllUsers requested
        if ($AllUsers -and -not $sysInfo.IsAdmin) {
            throw "The -AllUsers flag requires running as Administrator."
        }

        # Step 2: Check dependencies
        if (-not $SkipChecks) {
            Test-Dependencies
            Write-Host ""
        }

        # Step 3: Download and install
        Install-HermesSquad -SystemInfo $sysInfo
        Write-Host ""

        # Step 4: Add to PATH
        Add-ToPath
        Write-Host ""

        # Step 5: Create shortcuts
        New-StartMenuShortcut

        # Step 6: Initial configuration
        Initialize-Configuration
        Write-Host ""

        # Success!
        Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        Write-Host "    ✓ Hermes Squad installed successfully!" -ForegroundColor Green
        Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Get started:" -ForegroundColor White
        Write-Host "    hermes              " -ForegroundColor Cyan -NoNewline
        Write-Host "Launch TUI mode"
        Write-Host "    hermes --electron   " -ForegroundColor Cyan -NoNewline
        Write-Host "Launch GUI mode"
        Write-Host "    hermes --help       " -ForegroundColor Cyan -NoNewline
        Write-Host "Show all options"
        Write-Host ""
        Write-Host "  Quick start:" -ForegroundColor White
        Write-Host "    cd your-project; hermes" -ForegroundColor Cyan
        Write-Host ""

    } catch {
        Write-Error2 $_.Exception.Message
        Write-Host ""
        Write-Host "  Installation failed. For help:" -ForegroundColor Red
        Write-Host "    https://github.com/$Script:Repo/issues" -ForegroundColor Gray
        exit 1
    } finally {
        Remove-TempFiles
    }
}

# Run the installer
Main
