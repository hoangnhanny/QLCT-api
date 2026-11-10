import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'profiles' })
export class Profile {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email: string | null;

  @Column({
    name: 'auth_providers',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  authProviders?: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
