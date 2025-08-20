// 使用更稳定的导入方式
let fetch;
try {
  fetch = require('node-fetch');
} catch (error) {
  // 如果node-fetch不可用，尝试使用全局fetch（Node.js 18+）
  fetch = globalThis.fetch;
}

// 允许转发的请求头
const ALLOWED_HEADERS = [
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'cache-control',
  'content-length',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-requested-with',
  'x-api-key',
  'x-auth-token'
];

// 要过滤的请求头
const FILTERED_HEADERS = [
  'host',
  'connection',
  'via',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-amz-cf-id',
  'x-amz-trace-id',
  'x-real-ip',
  'cf-ray',
  'cf-connecting-ip'
];

// 安全的URL协议白名单
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

// 禁止访问的内网IP范围
const BLOCKED_IP_RANGES = [
  /^127\./,           // 127.0.0.0/8
  /^10\./,            // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
  /^192\.168\./,      // 192.168.0.0/16
  /^169\.254\./,      // 169.254.0.0/16 (链路本地)
  /^::1$/,            // IPv6 localhost
  /^fc00:/,           // IPv6 唯一本地地址
  /^fe80:/            // IPv6 链路本地地址
];

// 请求超时时间（毫秒）
const REQUEST_TIMEOUT = 30000;

// 最大重试次数
const MAX_RETRIES = 2;

// HTML内容类型检测
const HTML_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml'
];

// CSS内容类型检测
const CSS_CONTENT_TYPES = [
  'text/css'
];

// 需要重写的资源类型
const REWRITABLE_CONTENT_TYPES = [
  ...HTML_CONTENT_TYPES,
  ...CSS_CONTENT_TYPES
];

// URL验证函数
function validateUrl(url) {
  try {
    const parsedUrl = new URL(url);
    
    // 检查协议
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      throw new Error(`不允许的协议: ${parsedUrl.protocol}`);
    }
    
    // 检查是否为内网IP
    const hostname = parsedUrl.hostname;
    for (const pattern of BLOCKED_IP_RANGES) {
      if (pattern.test(hostname)) {
        throw new Error(`禁止访问内网地址: ${hostname}`);
      }
    }
    
    // 检查端口（可选，根据需要调整）
    const port = parsedUrl.port;
    if (port && (port < 80 || port > 65535)) {
      throw new Error(`无效端口: ${port}`);
    }
    
    return true;
  } catch (error) {
    throw new Error(`URL验证失败: ${error.message}`);
  }
}

// 创建带超时的fetch请求
function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('请求超时')), timeout)
    )
  ]);
}

// 带重试的请求函数
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      if (i === retries) {
        throw error;
      }
      // 指数退避重试
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

// 日志函数
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({
    timestamp,
    level,
    message,
    ...data
  }));
}

// 获取基础URL
function getBaseUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.protocol}//${parsedUrl.host}`;
  } catch (error) {
    return '';
  }
}

// 获取目录路径
function getDirectoryPath(url) {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const lastSlashIndex = pathname.lastIndexOf('/');
    return lastSlashIndex > 0 ? pathname.substring(0, lastSlashIndex + 1) : '/';
  } catch (error) {
    return '/';
  }
}

// 解析相对URL为绝对URL
function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch (error) {
    return relativeUrl;
  }
}

// 将绝对URL转换为代理URL
function toProxyUrl(absoluteUrl, proxyBase) {
  try {
    return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
  } catch (error) {
    return absoluteUrl;
  }
}

// HTML内容重写函数
function rewriteHtmlContent(html, originalUrl, proxyBase) {
  const baseUrl = getBaseUrl(originalUrl);
  const directoryPath = getDirectoryPath(originalUrl);
  const currentPageUrl = originalUrl;
  
  // 重写各种资源引用
  let rewrittenHtml = html
    // 重写 <link> 标签的 href 属性
    .replace(/(<link[^>]+href=["]?)([^"\s>]+)(["]?[^>]*>)/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        // 绝对URL，直接代理
        const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (url.startsWith('/')) {
        // 根相对路径
        const absoluteUrl = `${baseUrl}${url}`;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (!url.startsWith('#') && !url.startsWith('data:') && !url.startsWith('javascript:')) {
        // 相对路径
        const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      }
      return match;
    })
    // 重写 <script> 标签的 src 属性
    .replace(/(<script[^>]+src=["]?)([^"\s>]+)(["]?[^>]*>)/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (url.startsWith('/')) {
        const absoluteUrl = `${baseUrl}${url}`;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (!url.startsWith('#') && !url.startsWith('data:') && !url.startsWith('javascript:')) {
        const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      }
      return match;
    })
    // 重写 <img> 标签的 src 属性
    .replace(/(<img[^>]+src=["]?)([^"\s>]+)(["]?[^>]*>)/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (url.startsWith('/')) {
        const absoluteUrl = `${baseUrl}${url}`;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (!url.startsWith('#') && !url.startsWith('data:') && !url.startsWith('javascript:')) {
        const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      }
      return match;
    })
    // 重写 <form> 标签的 action 属性
    .replace(/(<form[^>]+action=["]?)([^"\s>]+)(["]?[^>]*>)/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (url.startsWith('/')) {
        const absoluteUrl = `${baseUrl}${url}`;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (!url.startsWith('#') && !url.startsWith('javascript:')) {
        const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      }
      return match;
    })
    // 重写 <a> 标签的 href 属性
    .replace(/(<a[^>]+href=["]?)([^"\s>]+)(["]?[^>]*>)/gi, (match, prefix, url, suffix) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (url.startsWith('/')) {
        const absoluteUrl = `${baseUrl}${url}`;
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      } else if (!url.startsWith('#') && !url.startsWith('mailto:') && !url.startsWith('tel:') && !url.startsWith('javascript:')) {
        const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
        return `${prefix}${toProxyUrl(absoluteUrl, proxyBase)}${suffix}`;
      }
      return match;
    });

  // 添加 base 标签来帮助处理相对路径
  if (!rewrittenHtml.includes('<base ')) {
    const baseTag = `<base href="${proxyBase}${encodeURIComponent(baseUrl)}/">`;
    rewrittenHtml = rewrittenHtml.replace(/(<head[^>]*>)/i, `$1\n  ${baseTag}`);
  }

  return rewrittenHtml;
}

// CSS内容重写函数
function rewriteCssContent(css, originalUrl, proxyBase) {
  const baseUrl = getBaseUrl(originalUrl);
  const directoryPath = getDirectoryPath(originalUrl);
  
  // 重写CSS中的url()引用
  return css.replace(/url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi, (match, url) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
      const absoluteUrl = url.startsWith('//') ? `https:${url}` : url;
      return `url("${toProxyUrl(absoluteUrl, proxyBase)}")`;
    } else if (url.startsWith('/')) {
      const absoluteUrl = `${baseUrl}${url}`;
      return `url("${toProxyUrl(absoluteUrl, proxyBase)}")`;
    } else if (!url.startsWith('#') && !url.startsWith('data:')) {
      const absoluteUrl = resolveUrl(`${baseUrl}${directoryPath}`, url);
      return `url("${toProxyUrl(absoluteUrl, proxyBase)}")`;
    }
    return match;
  });
}

module.exports.handler = async (event) => {
  const startTime = Date.now();
  
  try {
    // 处理 OPTIONS 预检请求
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        },
        body: ''
      };
    }

    // 检查fetch是否可用
    if (!fetch) {
      throw new Error('Fetch API不可用');
    }

    // 解析目标 URL
    const path = event.path.replace(/^\/proxy\//, '');
    if (!path) {
      throw new Error('缺少目标URL');
    }
    
    const targetUrl = decodeURIComponent(path);
    
    // 验证目标URL
    validateUrl(targetUrl);
    
    log('info', '代理请求开始', {
      method: event.httpMethod,
      targetUrl: targetUrl,
      userAgent: event.headers['user-agent'] || 'unknown'
    });

    // 构造请求头
    const headers = {};
    if (event.headers) {
      for (const [key, value] of Object.entries(event.headers)) {
        const lowerKey = key.toLowerCase();
        if (
          ALLOWED_HEADERS.includes(lowerKey) &&
          !FILTERED_HEADERS.includes(lowerKey) &&
          value !== undefined &&
          value !== null
        ) {
          headers[lowerKey] = value;
        }
      }
    }

    // 添加默认请求头
    if (!headers['user-agent']) {
      headers['user-agent'] = 'Universal-Proxy/1.0';
    }

    // 处理请求体
    let body = null;
    if (event.body) {
      try {
        body = event.isBase64Encoded ?
          Buffer.from(event.body, 'base64') :
          event.body;
      } catch (error) {
        throw new Error(`请求体解析失败: ${error.message}`);
      }
    }

    // 发起代理请求
    const response = await fetchWithRetry(targetUrl, {
      method: event.httpMethod,
      headers: headers,
      body: body,
      redirect: 'follow',
      compress: true
    });

    // 检查响应状态
    if (!response.ok && response.status >= 400) {
      log('warn', '目标服务器返回错误状态', {
        status: response.status,
        statusText: response.statusText,
        targetUrl: targetUrl
      });
    }

    // 处理响应
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    // 构造响应头
    const responseHeaders = {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'access-control-allow-headers': ALLOWED_HEADERS.join(', '),
      'vary': 'Origin'
    };

    // 保留一些有用的响应头
    const preserveHeaders = ['cache-control', 'expires', 'last-modified', 'etag'];
    for (const headerName of preserveHeaders) {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        responseHeaders[headerName] = headerValue;
      }
    }

    // 如果没有缓存控制头，添加默认的
    if (!responseHeaders['cache-control']) {
      responseHeaders['cache-control'] = 'public, max-age=3600';
    }

    // 检查是否需要重写内容
    let responseBody;
    let isBase64Encoded = true;
    
    const needsRewriting = REWRITABLE_CONTENT_TYPES.some(type => 
      contentType.toLowerCase().includes(type.toLowerCase())
    );
    
    if (needsRewriting && response.status === 200) {
      try {
        // 解码内容进行重写
        const textContent = new TextDecoder('utf-8').decode(buffer);
        const proxyBase = `/proxy/`;
        
        let rewrittenContent;
        if (HTML_CONTENT_TYPES.some(type => contentType.toLowerCase().includes(type.toLowerCase()))) {
          // HTML内容重写
          rewrittenContent = rewriteHtmlContent(textContent, targetUrl, proxyBase);
          log('info', 'HTML内容已重写', {
            originalSize: textContent.length,
            rewrittenSize: rewrittenContent.length,
            targetUrl: targetUrl
          });
        } else if (CSS_CONTENT_TYPES.some(type => contentType.toLowerCase().includes(type.toLowerCase()))) {
          // CSS内容重写
          rewrittenContent = rewriteCssContent(textContent, targetUrl, proxyBase);
          log('info', 'CSS内容已重写', {
            originalSize: textContent.length,
            rewrittenSize: rewrittenContent.length,
            targetUrl: targetUrl
          });
        } else {
          rewrittenContent = textContent;
        }
        
        responseBody = Buffer.from(rewrittenContent, 'utf-8').toString('base64');
      } catch (rewriteError) {
        log('warn', '内容重写失败，返回原始内容', {
          error: rewriteError.message,
          targetUrl: targetUrl
        });
        responseBody = Buffer.from(buffer).toString('base64');
      }
    } else {
      // 不需要重写或非200状态码，直接返回原始内容
      responseBody = Buffer.from(buffer).toString('base64');
    }

    const duration = Date.now() - startTime;
    log('info', '代理请求完成', {
      status: response.status,
      contentType: contentType,
      responseSize: buffer.byteLength,
      needsRewriting: needsRewriting,
      duration: duration
    });

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: responseBody,
      isBase64Encoded: isBase64Encoded
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    log('error', '代理请求失败', {
      error: error.message,
      stack: error.stack,
      duration: duration,
      targetUrl: event.path
    });

    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    if (error.message.includes('URL验证失败') || error.message.includes('禁止访问')) {
      statusCode = 403;
    } else if (error.message.includes('请求超时')) {
      statusCode = 504;
    } else if (error.message.includes('缺少目标URL')) {
      statusCode = 400;
    }

    return {
      statusCode: statusCode,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'access-control-allow-headers': ALLOWED_HEADERS.join(', ')
      },
      body: JSON.stringify({
        error: error.message || "代理请求失败",
        timestamp: new Date().toISOString()
      })
    };
  }
};