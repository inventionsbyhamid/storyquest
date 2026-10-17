export interface GateQuestion {
  a: number;
  b: number;
  answer: number;
}

export interface GateState {
  question: GateQuestion;
  entry: string;
  missed: boolean;
  passed: boolean;
}

export type GateAction = { type: 'digit'; digit: number; next: GateQuestion } | { type: 'erase' };

// Answers run from 12 to 81 and never repeat a digit, so pressing one key over and over never passes.
export function makeQuestion(random: () => number = Math.random): GateQuestion {
  const a = 3 + Math.floor(random() * 7);
  const b = 4 + Math.floor(random() * 6);
  return { a, b, answer: a * b };
}

export function questionText(question: GateQuestion): string {
  return `What is ${question.a} times ${question.b}?`;
}

export function createGateState(question: GateQuestion): GateState {
  return { question, entry: '', missed: false, passed: false };
}

export function gateReducer(state: GateState, action: GateAction): GateState {
  if (state.passed) return state;
  switch (action.type) {
    case 'digit': {
      const entry = state.entry + String(action.digit);
      if (entry.length < String(state.question.answer).length) return { ...state, entry, missed: false };
      if (Number(entry) === state.question.answer) return { ...state, entry, passed: true };
      return { question: action.next, entry: '', missed: true, passed: false };
    }
    case 'erase':
      return { ...state, entry: state.entry.slice(0, -1) };
    default:
      return state;
  }
}
