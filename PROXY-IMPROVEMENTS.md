# Netlify代理函数改进说明

## 主要改进

### 1. 安全性增强
- **SSRF防护**: 添加了URL验证，禁止访问内网地址（127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16等）
- **协议限制**: 只允许HTTP和HTTPS协议
- **端口验证**: 检查端口范围的有效性
- **请求头过滤**: 更完善的请求头白名单和黑名单机制

### 2. 稳定性提升
- **导入优化**: 修复了node-fetch的导入问题，支持Node.js 18+的原生fetch
- **超时控制**: 添加30秒请求超时机制
- **重试机制**: 实现指数退避重试，最多重试2次
- **错误处理**: 完善的错误分类和状态码映射

### 3. 性能优化
- **请求压缩**: 启用gzip压缩
- **缓存优化**: 保留目标服务器的缓存头，默认缓存1小时
- **响应头优化**: 保留有用的响应头（ETag, Last-Modified等）

### 4. 监控和日志
- **结构化日志**: JSON格式的详细日志记录
- **性能监控**: 记录请求耗时和响应大小
- **错误追踪**: 完整的错误堆栈和上下文信息

### 5. CORS改进
- **完整的CORS支持**: 支持所有常用HTTP方法
- **预检请求优化**: 改进OPTIONS请求处理
- **头部管理**: 更精确的CORS头部控制

## 安全特性

### 禁止访问的地址范围
- `127.0.0.0/8` - 本地回环地址
- `10.0.0.0/8` - 私有网络A类
- `172.16.0.0/12` - 私有网络B类
- `192.168.0.0/16` - 私有网络C类
- `169.254.0.0/16` - 链路本地地址
- IPv6本地地址和私有地址

### 允许的请求头
```javascript
[
  'accept', 'accept-encoding', 'accept-language',
  'authorization', 'cache-control', 'content-length',
  'content-type', 'cookie', 'origin', 'referer',
  'user-agent', 'x-requested-with', 'x-api-key',
  'x-auth-token'
]
```

## 使用方法

### 基本用法
```
GET /.netlify/functions/proxy/https://api.example.com/data
```

### 带参数的请求
```
GET /.netlify/functions/proxy/https://api.example.com/search?q=test
```

### POST请求
```
POST /.netlify/functions/proxy/https://api.example.com/submit
Content-Type: application/json

{"data": "value"}
```

## 错误处理

代理函数会返回适当的HTTP状态码：
- `400` - 缺少目标URL
- `403` - URL验证失败或禁止访问
- `504` - 请求超时
- `500` - 其他服务器错误

错误响应格式：
```json
{
  "error": "错误描述",
  "timestamp": "2025-08-20T04:04:08.034Z"
}
```

## 测试

运行测试脚本验证功能：
```bash
node test-proxy.js
```

测试包括：
- OPTIONS预检请求
- 正常GET请求
- 安全验证（内网地址阻止）

## 配置选项

可以通过修改`src/proxyCore.js`中的常量来调整配置：
- `REQUEST_TIMEOUT`: 请求超时时间（默认30秒）
- `MAX_RETRIES`: 最大重试次数（默认2次）
- `ALLOWED_HEADERS`: 允许的请求头列表
- `BLOCKED_IP_RANGES`: 禁止访问的IP范围

## 日志格式

所有日志都以JSON格式输出，包含：
- `timestamp`: 时间戳
- `level`: 日志级别（info, warn, error）
- `message`: 日志消息
- 其他上下文信息（URL、状态码、耗时等）