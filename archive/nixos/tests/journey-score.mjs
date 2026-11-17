// Policy and observations are included in the VM source digest. Scores express
// conformance to tested tasks, not subjective beauty or real-user satisfaction.
export const policy = Object.freeze({
  schema:'murakumo.journey-policy.v1', minimum:95,
  weights:Object.freeze({completion:40,safety:30,recovery:20,effort:10}),
  required:Object.freeze(['keyboard-local','updates-first-boot','updates-returning','lan-companion']),
  unverified:Object.freeze(['disk-installation','phone-passkey','wifi-provisioning','bluetooth-provisioning',
    'voice-conversation','administrative-ssh','hardware-update-recovery'])
});
function flag(value){return value===true;}
function budget(value,max){return Number.isInteger(value)&&value>0&&value<=max;}
export function scoreJourneys({first,second,gui}){
  const initial=first?.journeys?.updates||{},returning=second?.journeys?.updates||{};
  const remote=first?.journeys?.remote||{},again=second?.journeys?.remote||{};
  const observations={first,second,gui};
  const rows=[
    ['keyboard-local','Owner: no phone / no account',{
      completion:flag(gui?.completed)&&flag(gui?.languageSelected)&&flag(gui?.actionsVisible),
      safety:flag(gui?.accountNotClaimed),recovery:flag(gui?.escapeReturned),
      effort:budget(gui?.decisions,3)&&budget(gui?.keys,8)}],
    ['updates-first-boot','Owner: enable signed checks',{
      completion:flag(initial.completed)&&first?.savedConsent===false,
      safety:flag(initial.consentPreserved)&&flag(initial.activationHeld)&&first?.hardwareRecoveryQualified===false,
      recovery:flag(initial.returned),effort:budget(initial.decisions,3)}],
    ['updates-returning','Returning owner: retain update consent',{
      completion:flag(returning.completed)&&second?.savedConsent===true,
      safety:flag(returning.consentPreserved)&&flag(returning.activationHeld)&&second?.hardwareRecoveryQualified===false,
      recovery:flag(returning.returned),effort:budget(returning.decisions,2)}],
    ['lan-companion','Administrator: local LAN companion',{
      completion:flag(remote.completed)&&flag(again.completed),
      safety:[remote,again].every(r=>flag(r.certificateCompared)&&flag(r.approvalRequired)),
      recovery:[remote,again].every(r=>flag(r.revoked)),
      effort:[remote,again].every(r=>budget(r.decisions,2))}]
  ];
  const journeys=rows.map(([id,user,dimensions])=>{
    const score=Object.entries(policy.weights).reduce((n,[key,weight])=>n+(dimensions[key]?weight:0),0);
    return {id,user,evidence:id==='keyboard-local'?'vm-keyboard-ocr':'vm-service-scripted-menu',
      dimensions,score,passed:dimensions.completion&&dimensions.safety&&score>=policy.minimum};
  });
  return {schema:'murakumo.journey-score.v1',policy,observations,journeys,
    unverified:policy.unverified.map(id=>({id,status:'unverified',score:null})),
    coverage:{verified:journeys.length,total:journeys.length+policy.unverified.length},
    passed:journeys.every(j=>j.passed)};
}
export function validateJourneyScore(report){
  const expected=scoreJourneys(report?.observations||{});
  if(report?.schema!==expected.schema||JSON.stringify(report)!==JSON.stringify(expected)||!expected.passed)
    throw Error('user journey quality gate failed or evidence missing');
  return report;
}
