import { Text, TextProps } from 'react-native';
import { type } from '../../theme/tokens';

export type TextVariant = keyof typeof type;

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function ThemedText({ variant = 'body', color, style, ...rest }: ThemedTextProps) {
  return <Text style={[type[variant], color ? { color } : null, style]} {...rest} />;
}
