// Operator-only registration. Uses the deployed HTTPS API; bearer never enters renderer.
const [accountId,name,connectorUserId]=process.argv.slice(2);
const origin=process.env.PVH_GATEWAY_URL;
const credential=process.env.PVH_GATEWAY_CREDENTIAL;
if(!accountId||!name||!connectorUserId||!origin||!credential||new URL(origin).origin!==origin||new URL(origin).protocol!=='https:'){
  console.error('Usage: node scripts/register-zalo.mjs <local-account-uuid> <inbox-name> <connector-user-id>; PVH_GATEWAY_URL and an admin PVH_GATEWAY_CREDENTIAL are required.');process.exit(1);
}
try{
  const response=await fetch(`${origin}/api/inbox/connector/register`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({accountId,name,connectorUserId}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){console.error(`REGISTRATION_FAILED_HTTP_${response.status}`);process.exitCode=1;}
  else console.log('Registered. Keep exactly one connector host for this local account. Grant inbox access separately in employee management.');
}catch{console.error('REGISTRATION_NETWORK_FAILED');process.exitCode=1;}