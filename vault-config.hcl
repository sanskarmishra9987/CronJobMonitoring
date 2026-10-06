cd "C:\Users\aakas\Desktop\BACKUP FILE\CronJobMonitoring\CronJobMonitoring"

@"
storage "file" {
  path = "C:/vault-data"
}
listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = true
}
disable_mlock = true
"@ | Out-File -FilePath vault-config.hcl -Encoding ascii