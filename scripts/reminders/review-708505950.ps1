$baseDir = "G:\mvp\rosomaha"
$notePath = Join-Path $baseDir "seo-reports\708505950-goal-shift-2026-04-29.md"
$logPath = Join-Path $baseDir "seo-reports\review-reminders.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"

Add-Content -Path $logPath -Value "[$stamp] Reminder fired for campaign 708505950"

try {
    Start-Process notepad.exe $notePath
} catch {
}

try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Пора проверить кампанию 708505950 после изменения цели. Откройте заметку в seo-reports и сверьте Директ с CRM.",
        "Codex reminder: 708505950"
    ) | Out-Null
} catch {
}
