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

import type { PaginationMeta } from './api.js';

/**
 * Format a pagination footer for tool responses.
 * Returns an empty string if no pagination metadata is available.
 */
export function formatPaginationFooter(pagination?: PaginationMeta, resultCount?: number): string {
  if (!pagination) return '';

  const parts: string[] = [];

  if (pagination.page !== undefined && pagination.totalPages !== undefined) {
    parts.push(`Page ${pagination.page} of ${pagination.totalPages}`);
  } else if (pagination.page !== undefined) {
    parts.push(`Page ${pagination.page}`);
  }

  if (pagination.total !== undefined) {
    parts.push(`${pagination.total} total results`);
  }

  if (pagination.limit !== undefined && resultCount !== undefined) {
    parts.push(`showing ${resultCount} per page`);
  }

  if (parts.length === 0) return '';

  return `\n📄 ${parts.join(' · ')}`;
}
