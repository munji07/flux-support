const ATTACK_PATTERNS = [
  /ㅂㅅ/u,
  /병신/u,
  /멍청(?:하|해|아|이야|함)/u,
  /꺼져/u,
  /닥쳐/u,
];

const THREAT_PATTERNS = [
  /죽여/u,
  /죽인다/u,
  /가만\s*안\s*둬/u,
  /찾아간다/u,
];

const DEESCALATION_PATTERNS = [
  /미안/u,
  /내가\s*예민했음/u,
  /그만하자/u,
  /알겠음/u,
  /됐어/u,
  /괜찮음/u,
];

module.exports = {
  ATTACK_PATTERNS,
  THREAT_PATTERNS,
  DEESCALATION_PATTERNS,
};
