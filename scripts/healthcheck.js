const headers = process.env.APP_PASSWORD ? { Authorization: `Basic ${Buffer.from(`merchant:${process.env.APP_PASSWORD}`).toString('base64')}` } : {};
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, { headers, signal: AbortSignal.timeout(4000) });
  if (!response.ok) process.exit(1);
} catch { process.exit(1); }
