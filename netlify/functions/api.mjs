const headers = {'Cache-Control':'no-store','X-Robots-Tag':'noindex'};
export default async request => {
  const backend = Netlify.env.get('BACKEND_URL');
  const token = Netlify.env.get('BACKEND_API_TOKEN');
  const path = new URL(request.url).pathname;
  if (!backend || !token) return Response.json({ready:false,error:'Online downloads are being set up. Please check back soon.'},{status:path === '/api/health' ? 200 : 503,headers});
  if (!/^\/api\/(info|download|health|jobs\/[a-f0-9]{32}|files\/[a-f0-9]{32})$/.test(path)) return new Response('Not found',{status:404,headers});
  const target = new URL(path, backend);
  if (target.protocol !== 'https:') return Response.json({error:'Backend HTTPS configuration required.'},{status:503,headers});
  if (path.startsWith('/api/files/')) return new Response(null,{status:302,headers:{...headers,Location:target.href}});
  if (!['GET','POST'].includes(request.method)) return new Response('Method not allowed',{status:405,headers});
  try {
    const response = await fetch(target,{method:request.method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:request.method === 'POST' ? await request.text() : undefined,signal:AbortSignal.timeout(55000)});
    return new Response(response.body,{status:response.status,headers:{...headers,'Content-Type':'application/json'}});
  } catch { return Response.json({error:'The download server is temporarily unavailable. Please try again.'},{status:502,headers}); }
};
export const config = {path:'/api/*',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:120}};
