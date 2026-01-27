// Mock nanoid for testing
let counter = 0;

export const nanoid = (size = 21): string => {
  counter++;
  return `mock-id-${counter}`.padEnd(size, '0');
};

export const customAlphabet = (_alphabet: string, size: number) => {
  return () => nanoid(size);
};

export const resetNanoidMock = () => {
  counter = 0;
};
