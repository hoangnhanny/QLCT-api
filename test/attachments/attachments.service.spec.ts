import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttachmentsService } from '../../src/attachments/attachments.service';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let mockDb: any;
  let mockStorage: any;
  let mockSupabaseClient: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn(),
    };

    mockStorage = {
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.com/upload-signed-url' },
        error: null,
      }),
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.example.com/view-signed-url' },
        error: null,
      }),
    };

    mockSupabaseClient = {
      storage: {
        from: jest.fn().mockReturnValue(mockStorage),
      },
    };

    const mockSupabaseService = {
      db: mockDb,
      get client() {
        return mockSupabaseClient;
      },
    } as unknown as SupabaseService;

    service = new AttachmentsService(mockSupabaseService);
  });

  describe('createUploadUrl', () => {
    it('creates upload url for image/jpeg, image/png, image/webp', async () => {
      const resJpeg = await service.createUploadUrl(
        'ledger-1',
        'user-1',
        'image/jpeg',
      );
      expect(resJpeg.path).toMatch(/^ledger-1\/[a-f0-9-]+\.jpg$/);
      expect(resJpeg.uploadUrl).toBe(
        'https://storage.example.com/upload-signed-url',
      );

      const resPng = await service.createUploadUrl(
        'ledger-1',
        'user-1',
        'image/png',
      );
      expect(resPng.path).toMatch(/^ledger-1\/[a-f0-9-]+\.png$/);

      const resWebp = await service.createUploadUrl(
        'ledger-1',
        'user-1',
        'image/webp',
      );
      expect(resWebp.path).toMatch(/^ledger-1\/[a-f0-9-]+\.webp$/);
    });

    it('rejects non-image content type with BadRequestException', async () => {
      await expect(
        service.createUploadUrl('ledger-1', 'user-1', 'application/pdf' as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createUploadUrl('ledger-1', 'user-1', 'text/plain' as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createViewUrl', () => {
    it('returns signed view url when expense has image_path', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ image_path: 'ledger-1/receipt.jpg' }],
      });

      const res = await service.createViewUrl('ledger-1', 'exp-1');
      expect(res.url).toBe('https://storage.example.com/view-signed-url');
      expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(
        'ledger-1/receipt.jpg',
        300,
      );
    });

    it('throws NotFoundException if expense has no image_path', async () => {
      mockDb.query.mockResolvedValue({
        rows: [{ image_path: null }],
      });

      await expect(
        service.createViewUrl('ledger-1', 'exp-no-img'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if expense does not exist', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(
        service.createViewUrl('ledger-1', 'exp-non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
