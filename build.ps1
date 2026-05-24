$SRC = $PSScriptRoot + "\src"
$DIST = $PSScriptRoot + "\dist"
New-Item -ItemType Directory -Force -Path $DIST | Out-Null

function Write-Bundle($name, $files) {
    Write-Host "[build] $name.bundle.js - $($files.Count) files"
    $sb = New-Object System.Text.StringBuilder
    
    foreach ($file in $files) {
        $fullPath = $SRC + "\" + $file
        if (-not (Test-Path $fullPath)) {
            Write-Warning "MISSING: $file"
            continue
        }
        $content = Get-Content -Path $fullPath -Raw -Encoding UTF8
        [void]$sb.AppendLine()
        [void]$sb.AppendLine("// === $file ===")
        [void]$sb.Append($content)
        [void]$sb.AppendLine()
    }
    
    $out = $sb.ToString()
    $outPath = $DIST + "\" + $name + ".bundle.js"
    
    Write-Host "  outPath: $outPath"
    Write-Host "  outLength: $($out.Length)"
    
    if ($out.Length -eq 0) {
        Write-Warning "Empty output for $name"
        return
    }
    
    [System.IO.File]::WriteAllText($outPath, $out, [System.Text.UTF8Encoding]::new($false))
    
    $sizeKB = [math]::Round((Get-Item $outPath).Length / 1024, 1)
    Write-Host "  OK $name.bundle.js - $sizeKB KB"
}

$SIDEPANEL_FILES = @(
    "events\runtimeEvents.js",
    "utils\runtimeLogger.js",
    "runtime\runtimeState.js",
    "runtime\runtimeSession.js",
    "runtime\runtimeQueue.js",
    "runtime\runtimeContext.js",
    "trace\traceTypes.js",
    "trace\traceStore.js",
    "trace\runtimeTrace.js",
    "providers\baseProvider.js",
    "providers\llmProvider.js",
    "tools\actionRegistry.js",
    "tools\browserActionRuntime.js",
    "browser\actions\clickAction.js",
    "browser\actions\inputAction.js",
    "browser\actions\scrollAction.js",
    "browser\actions\extractAction.js",
    "browser\actions\waitElementAction.js",
    "browser\actions\hoverAction.js",
    "browser\actions\pressKeyAction.js",
    "browser\actions\scrollToElementAction.js",
    "browser\actions\scrollToBottomAction.js",
    "browser\actions\selectOptionAction.js",
    "browser\actions\extractAttributeAction.js",
    "browser\actions\navigateUrlAction.js",
    "browser\actions\openTabAction.js",
    "browser\actions\switchTabAction.js",
    "browser\browserActionDispatcher.js",
    "browser\tabRegistry.js",
    "tools\toolRegistry.js",
    "tools\toolDispatcher.js",
    "tools\actionExecutor.js",
    "memory\browserMemory.js",
    "memory\chatMemory.js",
    "runtime\react\loopMemory.js",
    "observation\observationBuilder.js",
    "observation\observationFetcher.js",
    "observation\observationSerializer.js",
    "prompts\promptBuilder.js",
    "planner\stepEvaluator.js",
    "planner\planGraph.js",
    "planner\goalDecomposer.js",
    "planner\replanner.js",
    "planner\plannerEngine.js",
    "recovery\actionRetry.js",
    "recovery\selectorRecovery.js",
    "recovery\recoveryStrategies.js",
    "recovery\recoveryManager.js",
    "recovery\recoveryStrategyTracker.js",
    "recovery\recoveryIntegration.js",
    "validation\selectorValidator.js",
    "validation\validationIntegration.js",
    "chat\chatRuntime.js",
    "runtime\react\loopController.js",
    "runtime\react\reactRuntimeLoop.js",
    "runtime\agentRuntime.js",
    "runtime\runtimeAPI.js",
    "browser\screenshotCapture.js",
    "ui\popupState.js",
    "ui\popupControls.js",
    "ui\popupRenderer.js",
    "ui\popupEvents.js",
    "ui\popupRuntime.js",
    "ui\sidepanel-config.js",
    "ui\sidepanel-tabs.js",
    "ui\sidepanel-images.js",
    "ui\sidepanel-chat.js",
    "ui\sidepanel-analyze.js",
    "ui\agentModeController.js",
    "ui\sidepanel-init.js",
    "ui\sidepanel.js",
    "..\benchmark\tasks\standard-tasks.js",
    "..\benchmark\runner.js"
)

$BACKGROUND_FILES = @(
    "events\runtimeEvents.js",
    "browser\tabRegistry.js",
    "..\background.js"
)

$POPUP_FILES = @(
    "events\runtimeEvents.js",
    "utils\runtimeLogger.js",
    "runtime\runtimeState.js",
    "runtime\runtimeSession.js",
    "runtime\runtimeQueue.js",
    "trace\traceTypes.js",
    "trace\traceStore.js",
    "trace\runtimeTrace.js",
    "providers\baseProvider.js",
    "providers\llmProvider.js",
    "tools\toolRegistry.js",
    "tools\toolDispatcher.js",
    "prompts\promptBuilder.js",
    "observation\observationBuilder.js",
    "observation\observationSerializer.js",
    "observation\observationFetcher.js",
    "tools\actionRegistry.js",
    "tools\actionExecutor.js",
    "tools\browserActionRuntime.js",
    "memory\browserMemory.js",
    "runtime\agentRuntime.js",
    "chat\chatRuntime.js",
    "runtime\runtimeAPI.js",
    "ui\popupState.js",
    "ui\popupRenderer.js",
    "ui\popupControls.js",
    "ui\popupEvents.js",
    "ui\popupRuntime.js",
    "ui\popup.js"
)

$CONTENT_FILES = @(
    "content\contentProcessor.js",
    "content\contentObserver.js",
    "content\elementLocator.js",
    "content\contentRuntime.js",
    "content\content.js"
)

Write-Host "[build] Starting..."

Write-Bundle "sidepanel" $SIDEPANEL_FILES
Write-Bundle "background" $BACKGROUND_FILES
Write-Bundle "content" $CONTENT_FILES
Write-Bundle "popup" $POPUP_FILES

Write-Host "[build] Done!"
