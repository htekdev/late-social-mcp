export interface ToolResponseContent {
  type: 'text';
  text: string;
}

export interface ToolResponse {
  [key: string]: unknown;
  content: ToolResponseContent[];
  isError?: boolean;
}

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

export function errorResponse(message: string): ToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}
