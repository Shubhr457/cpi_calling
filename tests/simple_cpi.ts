import { BN } from 'bn.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import { SimpleCpi } from '../target/types/simple_cpi';
import { Escrow } from '../target/types/escrow';
import { publicKey } from '@coral-xyz/anchor/dist/cjs/utils';

describe('simple_cpi', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const escrowProgram = anchor.workspace.Escrow as Program<Escrow>;
  const simpleCpiProgram = anchor.workspace.SimpleCpi as Program<SimpleCpi>;
  const payer = provider.wallet as anchor.Wallet;

  async function setupTest(owner: Keypair, allowed: Keypair) {
    const mint = await createMint(
      provider.connection,
      payer.payer, // Payer funds the mint creation
      payer.publicKey,
      null,
      0
    );

    const ownerTokenAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer, // Payer funds the ATA creation
      mint,
      owner.publicKey
    )).address;

    await mintTo(
      provider.connection,
      payer.payer, // Payer signs the minting
      mint,
      ownerTokenAccount,
      payer.publicKey,
      1000
    );

    const [escrowAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), owner.publicKey.toBuffer(), mint.toBuffer()],
      new PublicKey("GWiAFew8qfEz9vLApjigwvDiDpPK4SLMRUdWVDKekrVK")  // Convert string to PublicKey
    );
    
    // Log these for verification:
    console.log("Owner public key:", owner.publicKey.toBase58());
    console.log("Mint:", mint.toBase58());
    console.log("Escrow Program ID:", escrowProgram.programId.toBase58());
    console.log("Derived Escrow Account:", escrowAccount.toBase58());

    const escrowTokenAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer, // Payer funds the ATA creation
      mint,
      escrowAccount,
      true
    )).address;

    const [allowanceAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowance"), owner.publicKey.toBuffer(), allowed.publicKey.toBuffer(), mint.toBuffer()],
      simpleCpiProgram.programId
    );

    console.log("Mint:", mint.toBase58());
    console.log("Owner:", owner.publicKey.toBase58());
    console.log("Escrow Program ID:", escrowProgram.programId.toBase58());
    console.log("Calculated Escrow Account:", escrowAccount.toBase58());

    return { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount };
  }

  let owner: Keypair;
  let allowed: Keypair;

  before(async () => {
    // Use payer as owner, and generate a separate allowed keypair
    owner = payer.payer; // Use the provider wallet as owner
    allowed = Keypair.generate(); // Generate a new keypair for allowed user
    // No airdrop needed; assume payer has sufficient SOL balance
  });

  it("Creates allowance and deposits tokens successfully", async () => {
    const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = await setupTest(owner, allowed);

    const amount = new BN(500);
    const allowedAmount = new BN(300);

    try {
  const tx = await simpleCpiProgram.methods
    .createAllowance(amount, allowedAmount)
    .accounts({
      owner: owner.publicKey,
      allowedAddress: allowed.publicKey,
      ownerTokenAccount,
      escrowTokenAccount,
      escrowAccount,  // This should match the PDA derived above
      allowanceAccount,
      escrowProgram: escrowProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([owner])
    .rpc();

      await provider.connection.confirmTransaction(tx);
      
      const escrowState = await escrowProgram.account.escrowAccount.fetch(escrowAccount);
      assert.ok(escrowState.owner.equals(owner.publicKey), "Escrow owner should match");
      assert.ok(escrowState.amount.eq(amount), "Escrow amount should match");
      assert.ok(escrowState.mint.equals(mint), "Escrow mint should match");

      const allowanceState = await simpleCpiProgram.account.allowanceAccount.fetch(allowanceAccount);
      assert.ok(allowanceState.owner.equals(owner.publicKey), "Allowance owner should match");
      assert.ok(allowanceState.allowedAddress.equals(allowed.publicKey), "Allowed address should match");
      assert.ok(allowanceState.allowedAmount.eq(allowedAmount), "Allowed amount should match");
      assert.ok(allowanceState.mint.equals(mint), "Allowance mint should match");

      const ownerBalance = await getAccount(provider.connection, ownerTokenAccount);
      const escrowBalance = await getAccount(provider.connection, escrowTokenAccount);
      assert.equal(Number(ownerBalance.amount), 500, "Owner balance should be 500");
      assert.equal(Number(escrowBalance.amount), 500, "Escrow balance should be 500");
    } catch (err) {
      console.error("Transaction failed:", err);
      throw err;
    }
  });

  // it("Withdraws allowance successfully", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   const allowedUserTokenAccount = (await getOrCreateAssociatedTokenAccount(
  //     provider.connection,
  //     payer,
  //     mint,
  //     allowedUser.publicKey
  //   )).address;

  //   const withdrawAmount = new BN(200);
  //   const tx = await simpleCpiProgram.methods
  //     .withdrawAllowance(withdrawAmount)
  //     .accounts({
  //       user: allowedUser.publicKey,
  //       userTokenAccount: allowedUserTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     })
  //     .signers([allowedUser])
  //     .rpc();

  //   await provider.connection.confirmTransaction(tx);

  //   const allowanceState = await simpleCpiProgram.account.allowanceAccount.fetch(allowanceAccount);
  //   const escrowState = await escrowProgram.account.escrowAccount.fetch(escrowAccount);
  //   const allowedUserBalance = await getAccount(provider.connection, allowedUserTokenAccount);

  //   assert.ok(allowanceState.allowedAmount.eq(new BN(100)), "Remaining allowance should be 300 - 200 = 100");
  //   assert.ok(escrowState.amount.eq(new BN(300)), "Escrow should have 500 - 200 = 300 tokens");
  //   assert.equal(Number(allowedUserBalance.amount), 200, "Allowed user should have received 200 tokens");
  // });

  // it("Updates allowance successfully", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   const newAllowance = new BN(400);
  //   const tx = await simpleCpiProgram.methods
  //     .updateAllowance(newAllowance)
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       allowanceAccount,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   await provider.connection.confirmTransaction(tx);

  //   const allowanceState = await simpleCpiProgram.account.allowanceAccount.fetch(allowanceAccount);
  //   assert.ok(allowanceState.allowedAmount.eq(newAllowance), "Allowance should be updated to 400");
  // });

  // it("Fails to create allowance with zero deposit", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   try {
  //     await simpleCpiProgram.methods
  //       .createAllowance(new BN(0), new BN(300))
  //       .accounts({
  //         owner: owner.publicKey,
  //         allowedAddress: allowedUser.publicKey,
  //         ownerTokenAccount,
  //         escrowTokenAccount,
  //         escrowAccount,
  //         allowanceAccount,
  //         escrowProgram: escrowProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([owner])
  //       .rpc();
  //     assert.fail("Creating allowance with zero deposit should fail");
  //   } catch (err) {
  //     const anchorError = anchor.AnchorError.parse(err.logs);
  //     assert.ok(anchorError, "Should throw an AnchorError");
  //     assert.equal(anchorError.error.errorCode.code, "InsufficientBalance", "Should throw InsufficientBalance error");
  //   }
  // });

  // it("Fails to withdraw more than allowed amount", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   const allowedUserTokenAccount = (await getOrCreateAssociatedTokenAccount(
  //     provider.connection,
  //     payer,
  //     mint,
  //     allowedUser.publicKey
  //   )).address;

  //   try {
  //     await simpleCpiProgram.methods
  //       .withdrawAllowance(new BN(400))
  //       .accounts({
  //         user: allowedUser.publicKey,
  //         userTokenAccount: allowedUserTokenAccount,
  //         escrowTokenAccount,
  //         escrowAccount,
  //         allowanceAccount,
  //         escrowProgram: escrowProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .signers([allowedUser])
  //       .rpc();
  //     assert.fail("Withdrawal exceeding allowance should fail");
  //   } catch (err) {
  //     const anchorError = anchor.AnchorError.parse(err.logs);
  //     assert.ok(anchorError, "Should throw an AnchorError");
  //     assert.equal(anchorError.error.errorCode.code, "InsufficientAllowance", "Should throw InsufficientAllowance error");
  //   }
  // });

  // it("Fails to withdraw with unauthorized user", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   const unauthorizedUser = Keypair.generate();
  //   const fundTx = new Transaction().add(
  //     SystemProgram.transfer({
  //       fromPubkey: payer.publicKey,
  //       toPubkey: unauthorizedUser.publicKey,
  //       lamports: 1 * LAMPORTS_PER_SOL,
  //     })
  //   );
  //   await provider.sendAndConfirm(fundTx, [payer]);

  //   const unauthorizedTokenAccount = (await getOrCreateAssociatedTokenAccount(
  //     provider.connection,
  //     payer,
  //     mint,
  //     unauthorizedUser.publicKey
  //   )).address;

  //   try {
  //     await simpleCpiProgram.methods
  //       .withdrawAllowance(new BN(200))
  //       .accounts({
  //         user: unauthorizedUser.publicKey,
  //         userTokenAccount: unauthorizedTokenAccount,
  //         escrowTokenAccount,
  //         escrowAccount,
  //         allowanceAccount,
  //         escrowProgram: escrowProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .signers([unauthorizedUser])
  //       .rpc();
  //     assert.fail("Withdrawal by unauthorized user should fail");
  //   } catch (err) {
  //     const anchorError = anchor.AnchorError.parse(err.logs);
  //     assert.ok(anchorError, "Should throw an AnchorError");
  //     assert.equal(anchorError.error.errorCode.code, "Unauthorized", "Should throw Unauthorized error");
  //   }
  // });

  // it("Fails to update allowance by non-owner", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   try {
  //     await simpleCpiProgram.methods
  //       .updateAllowance(new BN(400))
  //       .accounts({
  //         owner: allowedUser.publicKey,
  //         allowedAddress: allowedUser.publicKey,
  //         allowanceAccount,
  //       })
  //       .signers([allowedUser])
  //       .rpc();
  //     assert.fail("Update by non-owner should fail");
  //   } catch (err) {
  //     const anchorError = anchor.AnchorError.parse(err.logs);
  //     assert.ok(anchorError, "Should throw an AnchorError");
  //     assert.equal(anchorError.error.errorCode.code, "Unauthorized", "Should throw Unauthorized error");
  //   }
  // });

  // it("Verifies allowance account space allocation", async () => {
  //   const { mint, ownerTokenAccount, escrowTokenAccount, escrowAccount, allowanceAccount } = 
  //     await setupAllowanceScenario(owner, allowedUser);
    
  //   await simpleCpiProgram.methods
  //     .createAllowance(new BN(500), new BN(300))
  //     .accounts({
  //       owner: owner.publicKey,
  //       allowedAddress: allowedUser.publicKey,
  //       ownerTokenAccount,
  //       escrowTokenAccount,
  //       escrowAccount,
  //       allowanceAccount,
  //       escrowProgram: escrowProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([owner])
  //     .rpc();

  //   const allowanceInfo = await provider.connection.getAccountInfo(allowanceAccount);
  //   assert.equal(
  //     allowanceInfo.data.length,
  //     8 + 32 + 32 + 8 + 32, // discriminator (8) + Pubkey owner (32) + Pubkey allowed_address (32) + u64 allowed_amount (8) + Pubkey mint (32)
  //     "Allowance account space should match defined structure (112 bytes)"
  //   );
  // });
});