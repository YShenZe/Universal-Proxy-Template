const fetchPromise = import('node-fetch').then(mod => mod.default);

module.exports.handler = async (event) => {
    const fetch = await fetchPromise;
    
    const path = event.path.replace(/^\/proxy\//, '');
    const targetUrl = decodeURIComponent(path);
    
    try {
        const response = await fetch(targetUrl);
        const buffer = await response.arrayBuffer();
        
        return {
            statusCode: response.status,
            headers: {
                'content-type': response.headers.get('content-type'),
                'cache-control': 'public, max-age=86400'
            },
            body: Buffer.from(buffer).toString('base64'),
            isBase64Encoded: true
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || "Proxy请求失败" })
        };
    }
};
