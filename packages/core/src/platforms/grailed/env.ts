export function getGrailedCredentials(): { appId: string; apiKey: string } {
  const appId = process.env.GRAILED_APP_ID;
  const apiKey = process.env.GRAILED_API_KEY;
  if (!appId || !apiKey) {
    throw new Error("GRAILED_APP_ID and GRAILED_API_KEY required");
  }
  return { appId, apiKey };
}

export async function validateGrailedCredentials(): Promise<void> {
  getGrailedCredentials();
}
