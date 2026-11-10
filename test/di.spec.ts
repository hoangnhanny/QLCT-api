import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

describe('Dependency Injection', () => {
  it('resolves all modules and guards without missing provider errors', async () => {
    const builder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        isInitialized: true,
        entityMetadatas: [],
        options: { type: 'postgres' },
        query: jest.fn(),
        transaction: jest.fn(),
        destroy: jest.fn().mockResolvedValue(undefined),
        getRepository: jest.fn().mockReturnValue({
          find: jest.fn(),
          findOne: jest.fn(),
          save: jest.fn(),
          create: jest.fn(),
        }),
      });

    const moduleRef = await builder.compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
