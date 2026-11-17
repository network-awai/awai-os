export function observations(){
  const boot=saved=>({savedConsent:saved,hardwareRecoveryQualified:false,journeys:{
    updates:{completed:true,consentPreserved:true,activationHeld:true,returned:true,decisions:saved?2:3},
    remote:{completed:true,certificateCompared:true,approvalRequired:true,revoked:true,decisions:2}}});
  return {first:boot(false),second:boot(true),gui:{languageSelected:true,completed:true,accountNotClaimed:true,escapeReturned:true,actionsVisible:true,decisions:3,keys:8}};
}
