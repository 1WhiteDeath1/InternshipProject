"""Access domain schemas: users, roles, and role permissions."""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    email: str
    full_name: str = Field(..., min_length=1, max_length=200)
    role_id: int
    status: str = "active"

class UserCreate(UserBase):
    password: str = Field(..., min_length=6)

class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[int] = None
    status: Optional[str] = None
    preferences: Optional[str] = None

class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    last_login: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    role_name: Optional[str] = None
    is_supervisor: bool = False

class UserListResponse(BaseModel):
    items: List[UserOut]
    total: int
    page: int
    page_size: int


class RolePermissionBase(BaseModel):
    module: str
    action: str
    data_scope: Optional[str] = None

class RolePermissionCreate(RolePermissionBase):
    pass

class RolePermissionOut(RolePermissionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int

class RoleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None

class RoleCreate(RoleBase):
    is_supervisor: bool = False
    permissions: List[RolePermissionCreate] = []

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_supervisor: Optional[bool] = None
    permissions: Optional[List[RolePermissionCreate]] = None

class RoleOut(RoleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_supervisor: bool
    created_at: datetime
    permissions: List[RolePermissionOut] = []
