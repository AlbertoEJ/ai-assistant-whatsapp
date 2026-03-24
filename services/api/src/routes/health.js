/**
 * Health check and metrics routes.
 * No auth required.
 */
export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }
  })
}
