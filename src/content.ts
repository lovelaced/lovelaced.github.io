// Every word the shader writes into the water, apart from what's in index.html.
// Lovecraft quotes are verbatim from the 1927 Amazing Stories text
// (Project Gutenberg #68236); italics in the original are marked with <em>.

export type Pigment = 'jet' | 'scheele' | 'cobalt' | 'paris';

export interface PigmentInfo {
  name: string;
  story: string;
  /** OKLCH: lightness 0..1, chroma, hue degrees. Chroma may exceed P3; it's gamut-mapped. */
  oklch: [number, number, number];
}

export const PIGMENTS: Record<Pigment, PigmentInfo> = {
  jet: {
    name: 'jet',
    story: 'fossilized wood from whitby, worn by victorians in mourning.',
    oklch: [0.32, 0.02, 280],
  },
  scheele: {
    name: 'scheele’s green',
    story: 'copper arsenite, 1775. it colored victorian wallpaper and sweets, and poisoned the people around them.',
    oklch: [0.62, 0.21, 133],
  },
  cobalt: {
    name: 'cobalt violet',
    story: 'cobalt arsenate. so toxic it’s no longer made.',
    oklch: [0.52, 0.29, 312],
  },
  paris: {
    name: 'paris green',
    story: 'copper acetoarsenite, 1814. painted by monet and van gogh, then sprayed on crops, then used to kill rats in the paris sewers.',
    oklch: [0.78, 0.25, 160],
  },
};

export type Phase = 'still' | 'welling' | 'bloom' | 'blight' | 'pour' | 'aftermath' | 'healing';

export const LOVECRAFT: Partial<Record<Phase, string>> = {
  welling: 'it was only by analogy that they called it colour at all',
  bloom: 'A dim though distinct luminosity seemed to inhere in all the vegetation',
  blight: 'All the verdure was going grey',
  pour: 'It was no longer <em>shining</em> out; it was <em>pouring</em> out',
  aftermath: 'It was just a colour out of space',
};

export const ATTRIBUTION = 'lovecraft, the colour out of space, 1927';
