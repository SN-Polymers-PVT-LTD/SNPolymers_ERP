import { describe, it, expect, vi } from 'vitest';
import { fetchAllActiveSubcontractors } from './subcontractMastersApi';

describe('fetchAllActiveSubcontractors API catalog auto-pagination', () => {
  it('correctly auto-paginates catalogs containing more than 1,000 records', async () => {
    const page1Items = Array.from({ length: 1000 }, (_, i) => ({
      id: `sub-${i + 1}`,
      subcontractor_name: `Subcontractor ${i + 1}`,
      is_active: true
    }));

    const page2Items = Array.from({ length: 250 }, (_, i) => ({
      id: `sub-${1000 + i + 1}`,
      subcontractor_name: `Subcontractor ${1000 + i + 1}`,
      is_active: true
    }));

    const mockFetcher = vi.fn()
      .mockResolvedValueOnce({
        data: {
          success: true,
          subcontractors: page1Items,
          pagination: { totalItems: 1250, page: 1, limit: 1000, totalPages: 2 }
        }
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          subcontractors: page2Items,
          pagination: { totalItems: 1250, page: 2, limit: 1000, totalPages: 2 }
        }
      });

    const result = await fetchAllActiveSubcontractors(mockFetcher);

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(mockFetcher).toHaveBeenNthCalledWith(1, { is_active: 'true', page: 1, limit: 1000 });
    expect(mockFetcher).toHaveBeenNthCalledWith(2, { is_active: 'true', page: 2, limit: 1000 });
    expect(result).toHaveLength(1250);
    expect(result[0].id).toBe('sub-1');
    expect(result[1249].id).toBe('sub-1250');
  });

  it('fails query when pagination metadata is missing', async () => {
    const mockFetcher = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        subcontractors: [{ id: 'sub-1', subcontractor_name: 'Alpha' }]
        // pagination omitted
      }
    });

    await expect(fetchAllActiveSubcontractors(mockFetcher)).rejects.toThrow(
      /Invalid or missing pagination metadata from subcontractors API/
    );
  });

  it('fails query when totalPages is malformed or invalid', async () => {
    const mockFetcher = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        subcontractors: [{ id: 'sub-1', subcontractor_name: 'Alpha' }],
        pagination: { totalPages: 'invalid', page: 1 }
      }
    });

    await expect(fetchAllActiveSubcontractors(mockFetcher)).rejects.toThrow(
      /Invalid or missing pagination metadata from subcontractors API/
    );
  });

  it('fails query when page number is missing in pagination metadata', async () => {
    const mockFetcher = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        subcontractors: [{ id: 'sub-1', subcontractor_name: 'Alpha' }],
        pagination: { totalPages: 1 } // missing page
      }
    });

    await expect(fetchAllActiveSubcontractors(mockFetcher)).rejects.toThrow(
      /Invalid or missing pagination metadata from subcontractors API/
    );
  });

  it('fails query when response structure lacks subcontractors array', async () => {
    const mockFetcher = vi.fn().mockResolvedValueOnce({
      data: {
        success: true,
        data: [] // wrong key
      }
    });

    await expect(fetchAllActiveSubcontractors(mockFetcher)).rejects.toThrow(
      /Invalid response structure from subcontractors API/
    );
  });

  it('rejects the entire query and does not return partial data when an intermediate page request fails', async () => {
    const page1Items = Array.from({ length: 1000 }, (_, i) => ({
      id: `sub-${i + 1}`,
      subcontractor_name: `Subcontractor ${i + 1}`,
      is_active: true
    }));

    const mockFetcher = vi.fn()
      .mockResolvedValueOnce({
        data: {
          success: true,
          subcontractors: page1Items,
          pagination: { totalItems: 2000, page: 1, limit: 1000, totalPages: 2 }
        }
      })
      .mockRejectedValueOnce(new Error('Network connection timeout on page 2'));

    await expect(fetchAllActiveSubcontractors(mockFetcher)).rejects.toThrow(
      'Network connection timeout on page 2'
    );
    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });
});
