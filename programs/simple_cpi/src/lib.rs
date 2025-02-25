#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

declare_id!("E5CBom9pwN4GXeFfZgdmczaMGpgWhDV3u6Ba2nrZUTZD");

// Automatically generate module using program IDL found in ./idls
declare_program!(escrow);

use crate::escrow::accounts::EscrowAccount;
use crate::escrow::cpi::accounts::{Deposit, Withdraw};
use crate::escrow::cpi::{deposit, withdraw};
use crate::escrow::program::Escrow;

#[program]
pub mod simple_cpi {
    use super::*;

    pub fn create_allowance(ctx: Context<CreateAllowance>, amount: u64, allowed_amount: u64) -> Result<()> {
        let allowance_account = &mut ctx.accounts.allowance_account;
        allowance_account.owner = *ctx.accounts.owner.key;
        allowance_account.allowed_address = *ctx.accounts.allowed_address.key;
        allowance_account.allowed_amount = allowed_amount;
        allowance_account.mint = ctx.accounts.owner_token_account.mint;

        // CPI call to escrow deposit
        let cpi_ctx = CpiContext::new(
            ctx.accounts.escrow_program.to_account_info(),
            Deposit {
                user: ctx.accounts.owner.to_account_info(),
                user_token_account: ctx.accounts.owner_token_account.to_account_info(),
                escrow_token_account: ctx.accounts.escrow_token_account.to_account_info(),
                escrow_account: ctx.accounts.escrow_account.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        
        deposit(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn withdraw_allowance(ctx: Context<WithdrawAllowance>, amount: u64) -> Result<()> {
        let allowance_account = &mut ctx.accounts.allowance_account;
        
        // Check if the allowed address is trying to withdraw
        require!(
            ctx.accounts.user.key() == allowance_account.allowed_address,
            ErrorCode::Unauthorized
        );
        
        // Check if there's enough allowance
        require!(
            amount <= allowance_account.allowed_amount,
            ErrorCode::InsufficientAllowance
        );
        
        // Update the allowance
        allowance_account.allowed_amount -= amount;
        
        // CPI call to escrow withdraw
        let cpi_ctx = CpiContext::new(
            ctx.accounts.escrow_program.to_account_info(),
            Withdraw {
                user: ctx.accounts.user.to_account_info(),
                user_token_account: ctx.accounts.user_token_account.to_account_info(),
                escrow_token_account: ctx.accounts.escrow_token_account.to_account_info(),
                escrow_account: ctx.accounts.escrow_account.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        );
        
        withdraw(cpi_ctx)?;
        
        Ok(())
    }
    
    pub fn update_allowance(ctx: Context<UpdateAllowance>, new_allowance: u64) -> Result<()> {
        let allowance_account = &mut ctx.accounts.allowance_account;
        
        // Ensure only the owner can update allowance
        require!(
            ctx.accounts.owner.key() == allowance_account.owner,
            ErrorCode::Unauthorized
        );
        
        allowance_account.allowed_amount = new_allowance;
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateAllowance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: This is just used as a reference for allowance
    pub allowed_address: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 8 + 32,
        seeds = [b"allowance", owner.key().as_ref(), allowed_address.key().as_ref(), owner_token_account.mint.as_ref()],
        bump
    )]
    pub allowance_account: Account<'info, AllowanceAccount>,
    pub escrow_program: Program<'info, Escrow>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawAllowance<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        mut,
        seeds = [b"allowance", allowance_account.owner.as_ref(), user.key().as_ref(), user_token_account.mint.as_ref()],
        bump
    )]
    pub allowance_account: Account<'info, AllowanceAccount>,
    pub escrow_program: Program<'info, Escrow>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateAllowance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub allowed_address: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"allowance", owner.key().as_ref(), allowed_address.key().as_ref(), allowance_account.mint.as_ref()],
        bump,
        constraint = allowance_account.owner == owner.key()
    )]
    pub allowance_account: Account<'info, AllowanceAccount>,
}

#[account]
pub struct AllowanceAccount {
    pub owner: Pubkey,           
    pub allowed_address: Pubkey, 
    pub allowed_amount: u64,     
    pub mint: Pubkey,           
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized access.")]
    Unauthorized,
    #[msg("Insufficient allowance.")]
    InsufficientAllowance,
}