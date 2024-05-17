function checkPermission(request: Request, env: Env, key: string) {
  switch (request.method) {
    case 'PUT':
    case 'DELETE':
      return request.headers.get('TOKEN') === env.AUTH_KEY_SECRET;
    default:
      return true;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    if (!checkPermission(request, env, key)) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    switch (request.method) {
      case 'GET':
      case 'HEAD':
        const object = await env.BUCKET_APP.get(key);

        if (object === null) {
          return Response.json({ message: 'Object Not Found!' }, { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);

        return new Response(object.body, {
          headers
        });
      case 'PUT':
        await env.BUCKET_APP.put(key, request.body);
        return Response.json({ message: `Put ${key} successfully!` });
      case 'DELETE':
        await env.BUCKET_APP.delete(key);
        return Response.json({ message: 'Deleted!' });
      default:
        return Response.json({ message: 'Method Not Allowed!' }, {
          status: 405,
          headers: {
            Allow: 'GET, HEAD, PUT, DELETE'
          }
        });
    }
  }
};
