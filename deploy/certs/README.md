# 证书目录（HTTPS 用）

备案通过后，把阿里云免费 DV 证书（下载时选 **Nginx** 格式）里的两个文件放到这里：

```
deploy/certs/fullchain.pem   ← 对应下载包里的 xxx.pem（含证书链）
deploy/certs/privkey.pem     ← 对应下载包里的 xxx.key
```

然后：

```bash
# 1) 生成 443 配置（把 example.com 换成你的域名）
sed 's/__DOMAIN__/example.com/g' deploy/nginx.https.conf > deploy/nginx.conf

# 2) 上传并重建前端容器
docker compose up -d --build frontend
```

注意事项：
- 证书文件不要提交到仓库（`.gitignore` 已排除本目录下的 *.pem / *.key）。
- 必须是 **fullchain**（完整链），只有叶子证书时部分安卓机会报「证书无效」。
- 切换后先用 `curl -I https://域名` 验证，再决定是否加 HSTS。
- 本目录为空时容器仍正常跑在 80 端口（nginx 不会因为缺证书而启动失败）。
