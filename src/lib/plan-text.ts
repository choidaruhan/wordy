type PlanReasonInput = {
  baseNew: number;
  effectiveNew: number;
  reason: string;
};

/** 적응형 신규 배분 이유를 사용자 문구로 바꾼다. */
export function planReasonText(plan: PlanReasonInput): string | null {
  switch (plan.reason) {
    case 'heavy_backlog':
      return '밀린 복습이 2주치 이상이라 오늘은 신규 단어를 넣지 않았습니다.';
    case 'moderate_backlog':
      return `밀린 복습을 먼저 끝내도록 신규를 ${plan.baseNew}개 → ${plan.effectiveNew}개로 줄였습니다.`;
    case 'light_backlog':
      return `복습 부담이 있어 신규를 ${plan.baseNew}개 → ${plan.effectiveNew}개로 줄였습니다.`;
    case 'low_adherence':
      return `최근 학습일이 적어 신규를 ${plan.baseNew}개 → ${plan.effectiveNew}개로 조정했습니다.`;
    case 'limited_new':
      return plan.effectiveNew > 0
        ? `오늘 새로 볼 수 있는 단어가 ${plan.effectiveNew}개라 그만큼만 진행합니다.`
        : '오늘 새로 볼 수 있는 단어가 없습니다.';
    default:
      return null;
  }
}
