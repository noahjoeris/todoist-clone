import { LABEL_COLORS, type LabelColor } from '../data/repositories';

export const colors = {
  background: '#1e1e1e',
  surface: '#262626',
  hover: '#333333',
  border: '#414141',
  text: '#eeeeee',
  muted: '#a3a3a3',
  accent: '#de594b',
  green: '#79c77b',
  error: '#ff9e95',
};

export const priorityColors = { 1: '#ff8075', 2: '#f3b45c', 3: '#8caeff', 4: colors.muted };

/** Todoist 20-color palette. https://developer.todoist.com/api/v1/#tag/Colors */
export const labelColorHex: Record<LabelColor, string> = {
  berry_red: '#B8255F',
  red: '#DC4C3E',
  orange: '#C77100',
  yellow: '#B29104',
  olive_green: '#949C31',
  lime_green: '#65A33A',
  green: '#369307',
  mint_green: '#42A393',
  teal: '#148FAD',
  sky_blue: '#319DC0',
  light_blue: '#6988A4',
  blue: '#4180FF',
  grape: '#692EC2',
  violet: '#CA3FEE',
  lavender: '#A4698C',
  magenta: '#E05095',
  salmon: '#C9766F',
  charcoal: '#808080',
  grey: '#999999',
  taupe: '#8F7A69',
};

export const labelColorNames: Record<LabelColor, string> = {
  berry_red: 'Berry Red',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  olive_green: 'Olive Green',
  lime_green: 'Lime Green',
  green: 'Green',
  mint_green: 'Mint Green',
  teal: 'Teal',
  sky_blue: 'Sky Blue',
  light_blue: 'Light Blue',
  blue: 'Blue',
  grape: 'Grape',
  violet: 'Violet',
  lavender: 'Lavender',
  magenta: 'Magenta',
  salmon: 'Salmon',
  charcoal: 'Charcoal',
  grey: 'Grey',
  taupe: 'Taupe',
};

export const labelColorList = LABEL_COLORS;

export function hexForLabelColor(color: string): string {
  if (color in labelColorHex) return labelColorHex[color as LabelColor];
  return labelColorHex.charcoal;
}

export function nameForLabelColor(color: string): string {
  if (color in labelColorNames) return labelColorNames[color as LabelColor];
  return labelColorNames.charcoal;
}
