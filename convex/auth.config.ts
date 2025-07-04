export default {
  providers: [
    {
      type: "customJwt",
      applicationId: process.env.APPLICATION_ID,
      issuer: process.env.ISSUER,
      jwks: process.env.JWKS_URL,
      algorithm: "RS256",
    },
  ],
};
